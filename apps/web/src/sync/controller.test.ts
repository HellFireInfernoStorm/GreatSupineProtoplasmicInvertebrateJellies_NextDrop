import {
  fieldConflictContextFixture,
  apiFieldConflictFixtures,
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
import { ApiRequestError } from "../lib/api";
import { SyncController, useSyncActivity } from "./controller";
import { setForceOffline } from "./hooks";
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
  feedHead: String(BigInt(data.feedCursor) + 1n),
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
    conflicts: async () => {
      calls.push("conflicts");
      return { items: [], serverTime: apiFixtures.clientEvent.capturedAt, feedHead: data.feedCursor };
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

  it("turning force offline off reconnects and flushes the outbox at once (#147)", async () => {
    const entry = await enqueue();
    await setForceOffline(true, controller);
    expect(calls).toEqual([]);
    expect(useSyncActivity.getState().offline).toBe(true);
    await setForceOffline(false, controller);
    expect(useSyncActivity.getState().offline).toBe(false);
    expect(calls).toContain("push");
    expect((await db.outbox.get(entry.clientEventId))?.state).toBe("acked");
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

describe("held fact outcomes (ADR 0042)", () => {
  const heldLoad = async (userId = "driver-1") => {
    const order = data.scope.trips[0]!.stops[0]!.order;
    const entry = await repository.enqueue({
      type: "LOAD_CONFIRMED",
      subject: { orderId: order.id },
      actor: { role: "DRIVER", userId },
      payload: { lines: [{ lineId: "line-1", qtyLoaded: 1 }] },
    });
    const conflictId = uuidv7();
    await db.outbox.update(entry.clientEventId, { state: "held", lastError: null, confirmedAt: entry.capturedAt });
    await db.conflictsLocal.add({ id: conflictId, clientEventId: entry.clientEventId, userId });
    return { entry, conflictId, orderId: order.id };
  };
  const decided = (
    clientEventId: string,
    conflictId: string,
    resolution: "ACCEPT_FACT" | "REJECT_FACT",
    note: string | null = null,
  ): ApiDto<"fieldConflict"> => ({
    conflictId,
    clientEventId,
    kind: "LOAD_AGAINST_CHANGED_PLAN",
    openedAt: apiFixtures.clientEvent.capturedAt,
    state: "RESOLVED",
    resolution,
    note,
    resolvedAt: apiFixtures.clientEvent.capturedAt,
  });
  beforeEach(async () => {
    data.scope.trips[0]!.stops[0]!.order.status = "PLANNED";
    await repository.replaceSnapshot(data, "driver-1");
  });

  it("confirms an accepted fact and keeps it projected until a snapshot covers the boundary", async () => {
    const { entry, conflictId, orderId } = await heldLoad();
    const boundary = String(BigInt(data.feedCursor) + 5n);
    transport.conflicts = async (ids) => {
      calls.push("conflicts");
      expect(ids).toEqual([entry.clientEventId]);
      return {
        items: [decided(entry.clientEventId, conflictId, "ACCEPT_FACT")],
        serverTime: entry.capturedAt,
        feedHead: boundary,
      };
    };
    // Held facts are not projected; the snapshot after the decision is still older than the boundary.
    expect((await repository.projectOrder(orderId, "driver-1"))?.status).toBe("PLANNED");
    await controller.syncNow();
    expect(calls).toEqual(["changes", "conflicts", "snapshot"]);
    expect(await db.outbox.get(entry.clientEventId)).toMatchObject({
      state: "acked",
      lastError: null,
      confirmationFeedHead: boundary,
      resolution: { conflictId, decision: "ACCEPT_FACT", note: null },
    });
    expect((await repository.projectOrder(orderId, "driver-1"))?.status).toBe("LOADED");
    expect((await db.conflictsLocal.get(conflictId))?.resolution?.decision).toBe("ACCEPT_FACT");
    // Once decided it is not asked about again; a covering snapshot retires it.
    calls = [];
    data.feedCursor = boundary;
    await controller.syncNow();
    expect(calls).toEqual(["changes"]);
    await repository.replaceSnapshot(data, "driver-1");
    expect(await db.outbox.get(entry.clientEventId)).toBeUndefined();
  });

  it("marks a rejected fact visibly rejected with the dispatcher's note and stops projecting it", async () => {
    const { entry, conflictId, orderId } = await heldLoad();
    transport.conflicts = async () => ({
      items: [decided(entry.clientEventId, conflictId, "REJECT_FACT", "Order was moved to another van")],
      serverTime: entry.capturedAt,
      feedHead: data.feedCursor,
    });
    await controller.syncNow();
    expect(await db.outbox.get(entry.clientEventId)).toMatchObject({
      state: "rejected",
      lastError: "CONFLICT_REJECTED",
      resolution: { conflictId, decision: "REJECT_FACT", note: "Order was moved to another van" },
    });
    expect((await repository.projectOrder(orderId, "driver-1"))?.status).toBe("PLANNED");
    // Rejected work is kept, not pruned, even by a newer snapshot.
    data.feedCursor = String(BigInt(data.feedCursor) + 50n);
    await repository.replaceSnapshot(data, "driver-1");
    expect((await db.outbox.get(entry.clientEventId))?.state).toBe("rejected");
  });

  it("keeps open, unknown, uncorrelated and unreachable outcomes held without blocking new work", async () => {
    const open = await heldLoad();
    const unknown = await heldLoad();
    transport.conflicts = async () => ({
      items: [
        { ...apiFieldConflictFixtures.open, conflictId: open.conflictId, clientEventId: open.entry.clientEventId },
        // An outcome for an event this device did not ask about is ignored.
        decided(uuidv7(), uuidv7(), "REJECT_FACT"),
      ],
      serverTime: open.entry.capturedAt,
      feedHead: data.feedCursor,
    });
    await controller.syncNow();
    for (const { entry } of [open, unknown])
      expect(await db.outbox.get(entry.clientEventId)).toMatchObject({ state: "held" });

    transport.conflicts = async () => {
      throw new ApiRequestError("network", null, null, "offline");
    };
    const fresh = await enqueue();
    await controller.syncNow();
    expect((await db.outbox.get(fresh.clientEventId))?.state).toBe("acked");
    for (const { entry } of [open, unknown])
      expect(await db.outbox.get(entry.clientEventId)).toMatchObject({ state: "held" });
  });

  it("recovers a decision after missed hints and a cold resume, asking only for this user's held facts", async () => {
    const { entry, conflictId } = await heldLoad();
    const other = await heldLoad("driver-2");
    // The saved cursor is already past the resolution: the feed has nothing more to say.
    transport.changes = async () => ({ items: [], head: data.feedCursor, resetEpoch: data.resetEpoch });
    let asked: string[] = [];
    transport.conflicts = async (ids) => {
      asked = ids;
      return {
        items: [decided(entry.clientEventId, conflictId, "REJECT_FACT")],
        serverTime: entry.capturedAt,
        feedHead: data.feedCursor,
      };
    };
    // A new controller over the same database stands in for a reopened app.
    const resumed = new SyncController(
      new FieldRepository(db),
      transport,
      () => "driver-1",
      () => false,
    );
    await resumed.syncNow();
    expect(asked).toEqual([entry.clientEventId]);
    expect((await db.outbox.get(entry.clientEventId))?.state).toBe("rejected");
    expect((await db.outbox.get(other.entry.clientEventId))?.state).toBe("held");
  });
});

it("keeps accepted work projected when the confirming snapshot fails, then prunes with a covering snapshot", async () => {
  const order = data.scope.trips[0]!.stops[0]!.order;
  order.status = "PLANNED";
  await repository.replaceSnapshot(data, "driver-1");
  const entry = await repository.enqueue({
    type: "LOAD_CONFIRMED",
    subject: { orderId: order.id },
    actor: { role: "DRIVER", userId: "driver-1" },
    payload: { lines: [{ lineId: "line-1", qtyLoaded: 1 }] },
  });
  transport.snapshot = async () => {
    throw new Error("No signal after acceptance");
  };
  await controller.syncNow();
  expect((await db.outbox.get(entry.clientEventId))?.state).toBe("acked");
  expect((await repository.projectOrder(order.id, "driver-1"))?.status).toBe("LOADED");
  // An empty filtered feed advances the pull cursor, but cannot confirm a stale snapshot.
  transport.changes = async () => ({
    items: [],
    head: String(BigInt(data.feedCursor) + 10n),
    resetEpoch: data.resetEpoch,
  });
  await controller.syncNow();
  expect(await db.outbox.get(entry.clientEventId)).toBeDefined();
  data.feedCursor = String(BigInt(data.feedCursor) + 1n);
  order.status = "LOADED";
  await repository.replaceSnapshot(data, "driver-1");
  expect(await db.outbox.get(entry.clientEventId)).toBeUndefined();
  expect((await repository.projectOrder(order.id, "driver-1"))?.status).toBe("LOADED");
});

it("a foreground trigger during a failing flight retries immediately and is joined by the caller", async () => {
  const entry = await enqueue();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pushes = 0;
  transport.push = async (_id, events) => {
    pushes++;
    if (pushes === 1) {
      entered();
      await gate;
      throw new Error("offline");
    }
    return accepted(events);
  };
  const flight = controller.syncNow();
  await started;
  const retry = controller.syncNow();
  expect(retry).toBe(flight);
  release();
  await retry;
  expect(pushes).toBe(2);
  expect(await db.outbox.get(entry.clientEventId)).toMatchObject({ state: "acked", attempts: 2 });
});

it.each([413, 502])("only retries transient blob failures (HTTP %s)", async (status) => {
  const id = uuidv7();
  await db.blobQueue.add({
    clientBlobId: id,
    userId: "driver-1",
    bytes: new Blob(["image"]),
    state: "pending",
    attempts: 0,
    lastError: null,
  });
  let uploads = 0;
  transport.upload = async () => {
    uploads++;
    throw new ApiRequestError("http", status, null, "Blob upload failed");
  };
  await controller.syncNow();
  expect((await db.blobQueue.get(id))?.state).toBe(status === 413 ? "failed" : "pending");
  await controller.syncNow();
  expect(uploads).toBe(status === 413 ? 1 : 2);
});

it("persists open historical context across snapshot replacement and cold resume, retaining dispatcher decision", async () => {
  await repository.replaceSnapshot(data, "driver-1");
  const entry = await enqueue();
  const conflictId = uuidv7();
  await db.outbox.update(entry.clientEventId, { state: "held" });
  const item = structuredClone(fieldConflictContextFixture);
  item.clientEventId = entry.clientEventId;
  item.conflictId = conflictId;
  item.context.fact.clientEventId = entry.clientEventId;
  item.context.fact.actor.userId = "driver-1";
  transport.conflicts = async () => ({
    items: [item],
    serverTime: entry.capturedAt,
    feedHead: data.feedCursor,
    resetEpoch: data.resetEpoch,
  });
  await controller.syncNow();
  await repository.replaceSnapshot({ ...data, planVersion: 9 }, "driver-1");
  const resumed = new SyncController(
    new FieldRepository(db),
    transport,
    () => "driver-1",
    () => false,
  );
  await resumed.syncNow();
  expect((await db.conflictsLocal.get(conflictId))?.context).toEqual(item.context);
  transport.conflicts = async () => ({
    items: [
      { ...item, state: "RESOLVED", resolution: "REJECT_FACT", note: "Store moved", resolvedAt: entry.capturedAt },
    ],
    serverTime: entry.capturedAt,
    feedHead: data.feedCursor,
  });
  await resumed.syncNow();
  expect(await db.conflictsLocal.get(conflictId)).toMatchObject({
    context: item.context,
    resolution: { decision: "REJECT_FACT", note: "Store moved" },
  });
  expect((await db.outbox.get(entry.clientEventId))?.state).toBe("rejected");
});
it("ignores another owner's context and discards old context when lookup reports a reset", async () => {
  await repository.replaceSnapshot(data, "driver-1");
  const entry = await enqueue();
  await db.outbox.update(entry.clientEventId, { state: "held" });
  const item = structuredClone(fieldConflictContextFixture);
  item.clientEventId = entry.clientEventId;
  item.context.fact.clientEventId = entry.clientEventId;
  transport.conflicts = async () => ({
    items: [item],
    serverTime: entry.capturedAt,
    feedHead: data.feedCursor,
    resetEpoch: data.resetEpoch,
  });
  await controller.syncNow();
  expect(await db.conflictsLocal.count()).toBe(0);
  item.context.fact.actor.userId = "driver-1";
  await controller.syncNow();
  expect(await db.conflictsLocal.count()).toBe(1);
  const nextEpoch = data.resetEpoch + 1;
  transport.conflicts = async () => ({
    items: [item],
    serverTime: entry.capturedAt,
    feedHead: data.feedCursor,
    resetEpoch: nextEpoch,
  });
  data = { ...data, resetEpoch: nextEpoch };
  await controller.syncNow();
  expect(await db.conflictsLocal.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});
