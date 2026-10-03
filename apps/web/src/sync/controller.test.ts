import {
  apiFixtures,
  apiVariantFixtures,
  type ClientEvent,
  type FieldSnapshot,
  type ApiDto,
} from "@nextdrop/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase } from "./database";
import { FieldRepository } from "./repository";
import { SyncController } from "./controller";
import type { SyncTransport } from "./transport";

let db: OfflineDatabase;
let repository: FieldRepository;
let controller: SyncController;
let data: FieldSnapshot;
let transport: SyncTransport;
let calls: string[];
const enqueue = () =>
  repository.enqueue({
    type: "LOAD_CONFIRMED",
    payload: apiFixtures.clientEvent.payload,
    subject: apiFixtures.clientEvent.subject,
    actor: { role: "DRIVER", userId: "driver-1" },
  });
const accepted = (events: ClientEvent[]): ApiDto<"syncEventsResponse"> => ({
  results: events.map((e) => ({
    clientEventId: e.clientEventId,
    status: "ACCEPTED",
    serverEventId: uuidv7(),
    receivedAt: e.capturedAt,
  })),
  serverTime: apiFixtures.clientEvent.capturedAt,
  feedHead: "9007199254740993",
});
beforeEach(async () => {
  db = new OfflineDatabase(`controller-${uuidv7()}`);
  repository = new FieldRepository(db);
  await db.set("deviceId", uuidv7());
  data = structuredClone(apiVariantFixtures.fieldSnapshot.DRIVER);
  calls = [];
  transport = {
    snapshot: async () => {
      calls.push("snapshot");
      return data;
    },
    changes: async () => {
      calls.push("changes");
      return { items: [], head: data.feedCursor, resetEpoch: data.resetEpoch };
    },
    push: async (_id, events) => {
      calls.push("push");
      return accepted(events);
    },
    upload: async () => {
      calls.push("blob");
    },
  };
  controller = new SyncController(
    repository,
    transport,
    () => "driver-1",
    () => false,
  );
});
afterEach(async () => db.delete());

describe("sync state machine", () => {
  it("only drops pending on confirmation and sends text before blobs", async () => {
    const entry = await enqueue();
    await db.blobQueue.add({
      clientBlobId: uuidv7(),
      userId: "driver-1",
      bytes: new Blob(["image"], { type: "image/jpeg" }),
      state: "pending",
      attempts: 0,
      lastError: null,
    });
    await controller.syncNow();
    expect((await db.outbox.get(entry.clientEventId))?.state).toBe("acked");
    expect(calls.indexOf("push")).toBeLessThan(calls.indexOf("blob"));
    expect(await db.value("feedCursor")).toBe(data.feedCursor); // push feedHead cannot skip pull data
  });

  it("retries interrupted sends and keeps IDs stable on network failure", async () => {
    const entry = await enqueue();
    await db.outbox.update(entry.clientEventId, { state: "sending" });
    transport.push = async () => {
      throw new Error("No signal");
    };
    await controller.syncNow();
    expect(await db.outbox.get(entry.clientEventId)).toMatchObject({
      state: "pending",
      attempts: 1,
      lastError: "TRANSPORT_FAILED",
    });
    transport.push = async (_id, events) => accepted(events);
    await controller.syncNow();
    expect(await db.outbox.get(entry.clientEventId)).toMatchObject({ state: "acked", attempts: 2 });
  });

  it("correlates null-ID rejections by batch index and keeps held facts visible", async () => {
    const first = await enqueue();
    const second = await enqueue();
    transport.push = async () => ({
      serverTime: first.capturedAt,
      feedHead: "1",
      results: [
        { clientEventId: null, index: 0, status: "REJECTED", code: "SCHEMA_INVALID", receivedAt: first.capturedAt },
        {
          clientEventId: second.clientEventId,
          status: "HELD_CONFLICT",
          conflictId: uuidv7(),
          receivedAt: second.capturedAt,
        },
      ],
    });
    await controller.syncNow();
    expect(await db.outbox.get(first.clientEventId)).toMatchObject({ state: "failed", lastError: "SCHEMA_INVALID" });
    expect((await db.outbox.get(second.clientEventId))?.state).toBe("held");
    expect(await db.conflictsLocal.count()).toBe(1);
  });

  it("missing acknowledgements remain pending instead of silently disappearing", async () => {
    const entry = await enqueue();
    transport.push = async () => ({ results: [], serverTime: entry.capturedAt, feedHead: "1" });
    await controller.syncNow();
    expect(await db.outbox.get(entry.clientEventId)).toMatchObject({
      state: "pending",
      lastError: "MISSING_CONFIRMATION",
    });
  });

  it("checks epoch before sending stale work", async () => {
    await repository.replaceSnapshot(data, "driver-1");
    await enqueue();
    data = { ...data, resetEpoch: data.resetEpoch + 1 };
    await controller.syncNow();
    expect(calls).not.toContain("push");
    expect(await db.outbox.count()).toBe(0);
    expect(await db.value("resetEpoch")).toBe(data.resetEpoch);
  });

  it("does not leak another user's facts to the current account", async () => {
    await repository.enqueue({ ...apiFixtures.clientEvent, actor: { role: "LOADER", userId: "other-loader" } });
    await controller.syncNow();
    expect(calls).not.toContain("push");
    expect((await db.outbox.toArray())[0]?.state).toBe("pending");
  });

  it("force offline and reauth both stop all requests", async () => {
    await enqueue();
    await db.set("simulateOffline", true);
    await controller.syncNow();
    expect(calls).toEqual([]);
    await db.set("simulateOffline", false);
    const paused = new SyncController(
      repository,
      transport,
      () => "driver-1",
      () => true,
    );
    await paused.syncNow();
    expect(calls).toEqual([]);
  });

  it("serializes simultaneous sync requests without duplicate concurrent pushes", async () => {
    await enqueue();
    await Promise.all([controller.syncNow(), controller.syncNow()]);
    expect(calls.filter((c) => c === "push")).toHaveLength(1);
    // A scheduled second pass may be completing; join it before database teardown.
    await controller.syncNow();
  });

  it("advances an empty audience-filtered page to its exact large string head", async () => {
    await repository.replaceSnapshot(data, "driver-1");
    transport.changes = async () => ({ items: [], head: "9007199254740993", resetEpoch: data.resetEpoch });
    await controller.syncNow();
    expect(await db.value("feedCursor")).toBe("9007199254740993");
  });
});

it("pulls full pages by string cursor then replaces the snapshot once", async () => {
  await repository.replaceSnapshot(data, "driver-1");
  const seen: string[] = [];
  transport.changes = async (after) => {
    seen.push(after);
    return seen.length === 1
      ? {
          items: Array.from({ length: 100 }, (_, index) => ({
            seq: String(BigInt(after) + BigInt(index + 1)),
            kind: "order_changed" as const,
            entity: { type: "order", id: "an-order" },
            at: apiFixtures.clientEvent.capturedAt,
          })),
          head: String(BigInt(data.feedCursor) + 1000n),
          resetEpoch: data.resetEpoch,
        }
      : { items: [], head: String(BigInt(data.feedCursor) + 1000n), resetEpoch: data.resetEpoch };
  };
  await controller.syncNow();
  expect(seen).toEqual([data.feedCursor, String(BigInt(data.feedCursor) + 100n)]);
  expect(calls.filter((c) => c === "snapshot")).toHaveLength(1);
});

it("a second controller cannot claim the same device while the first sends", async () => {
  await enqueue();
  let sending!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    sending = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pushes = 0;
  transport.push = async (_id, events) => {
    pushes++;
    sending();
    await gate;
    return accepted(events);
  };
  const first = controller.syncNow();
  await started;
  const second = new SyncController(
    repository,
    transport,
    () => "driver-1",
    () => false,
  );
  await second.syncNow();
  expect(pushes).toBe(1);
  release();
  await first;
  expect((await db.outbox.toArray())[0]?.state).toBe("acked");
});

it("removes the local held notice only when the server feed confirms conflict resolution", async () => {
  await repository.replaceSnapshot(data, "driver-1");
  const entry = await enqueue();
  const conflictId = uuidv7();
  await db.outbox.update(entry.clientEventId, { state: "held" });
  await db.conflictsLocal.add({ id: conflictId, clientEventId: entry.clientEventId, userId: "driver-1" });
  transport.changes = async () => ({
    items: [
      {
        seq: data.feedCursor,
        kind: "conflict_resolved",
        entity: { type: "conflict", id: conflictId },
        at: entry.capturedAt,
      },
    ],
    head: data.feedCursor,
    resetEpoch: data.resetEpoch,
  });
  await controller.syncNow();
  expect(await db.conflictsLocal.count()).toBe(0);
  expect((await db.outbox.get(entry.clientEventId))?.state).toBe("acked");
});
