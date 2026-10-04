import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { apiVariantFixtures, type FieldSnapshot } from "@nextdrop/contracts";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase, type FieldReceipt } from "../../sync/database";
import { FieldRepository } from "../../sync/repository";
import { reversalKey, saveDraft, undoDraft, promoteDraft } from "./drafts";
import { projectDrafts } from "./model";
import { Dock } from "./Dock";
import type { LoaderData } from "./data";
import type * as LoaderParts from "./parts";
import type * as SessionModule from "../../lib/session";
import "../../i18n";

vi.mock("../../lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  useSession: () => ({ user: { id: "loader-60" } }),
}));
vi.mock("./parts", async (importOriginal) => ({
  ...(await importOriginal<typeof LoaderParts>()),
  Frame: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
const userId = "loader-60";
let db: OfflineDatabase;
let repository: FieldRepository;
function snapshot(to: "PLANNED" | "DEFERRED" = "DEFERRED"): Extract<FieldSnapshot, { role: "LOADER" }> {
  const value: Extract<FieldSnapshot, { role: "LOADER" }> = structuredClone(apiVariantFixtures.fieldSnapshot.LOADER);
  const order = value.scope.trips[0]!.stops[0]!.order;
  order.status = "LOADED";
  order.pendingReversal = { to, planVersion: value.planVersion! };
  order.lines[0]!.qtyLoaded = 10;
  value.scope.reversals = [order];
  value.scope.trips = [];
  return value;
}
function input(value: ReturnType<typeof snapshot>) {
  const order = value.scope.reversals[0]!;
  return {
    label: order.displayId,
    receipt: {
      id: reversalKey(userId, value, order.id),
      userId,
      resetEpoch: value.resetEpoch,
      date: value.scope.date,
      tripId: order.assignment?.tripId ?? "",
      orderId: order.id,
      kind: "LOAD_REVERSED" as const,
      planVersion: value.planVersion!,
    },
    intents: [
      {
        type: "LOAD_REVERSED" as const,
        actor: { userId, role: "LOADER" as const },
        subject: { orderId: order.id },
        payload: {
          orderId: order.id,
          lines: order.lines.map((line) => ({ lineId: line.id, qtyLoaded: line.qtyLoaded })),
        },
      },
    ],
    capturedAt: "2026-10-04T16:00:00.000Z",
    clockOffsetMs: 60000,
  };
}
beforeEach(async () => {
  db = new OfflineDatabase(`loader-reversal-60-${uuidv7()}`);
  repository = new FieldRepository(db);
  await db.set("deviceId", uuidv7());
});
afterEach(async () => {
  await db.delete();
});

describe("Loader reversal tasks", () => {
  it.each(["PLANNED", "DEFERRED"] as const)(
    "saves a removed order offline, with Undo, then projects %s",
    async (to) => {
      const value = snapshot(to);
      const order = value.scope.reversals[0]!;
      // A reversal has no current trip requirement, even if its original assignment is gone.
      order.assignment = null;
      await repository.replaceSnapshot(value, userId);
      const original = (await repository.projectOrder(order.id, userId))!;
      const draft = await saveDraft(repository, input(value), 1000);
      expect(await db.outbox.count()).toBe(0);
      expect(projectDrafts(original, [draft])).toMatchObject({ status: to, pendingReversal: null, loaded: [] });
      expect(await undoDraft(repository, draft.key, "another-loader", 2000)).toBe(false);
      expect(await undoDraft(repository, draft.key, userId, 2000)).toBe(true);
      expect((await repository.projectOrder(order.id, userId))!.status).toBe("LOADED");
      const saved = await saveDraft(repository, input(value), 3000);
      expect(await promoteDraft(repository, saved.key, userId, 7999)).toBe(false);
      expect(await promoteDraft(repository, saved.key, userId, 8000)).toBe(true);
      expect(await promoteDraft(repository, saved.key, userId, 8000)).toBe(false);
      expect((await repository.projectOrder(order.id, userId))!).toMatchObject({
        status: to,
        loaded: [],
        pendingReversal: null,
      });
      expect(await db.outbox.toArray()).toMatchObject([
        {
          type: "LOAD_REVERSED",
          subject: { orderId: order.id },
          state: "pending",
          capturedAt: saved.capturedAt,
          clockOffsetMs: 60000,
          basedOnPlanVersion: value.planVersion,
        },
      ]);
      expect(await db.value(`fieldReceipt:${saved.receipt.id}`)).toBeDefined();
      await expect(saveDraft(repository, input(value), 9000)).rejects.toThrow("Reversal unavailable");
    },
  );

  it("shows a reversal on the dock without current trips", async () => {
    const value = snapshot();
    await repository.replaceSnapshot(value, userId);
    const order = value.scope.reversals[0]!;
    const data: LoaderData = {
      snapshot: value,
      states: { [order.id]: (await repository.projectOrder(order.id, userId))! },
      events: [],
      receipts: [],
      blobs: [],
      drafts: [],
      baseline: value.planVersion,
      loaded: true,
      error: false,
    };
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Dock, { data })));
    expect(html).toContain("Unload requests");
    expect(html).toContain(order.displayId);
    expect(html).toContain("Review unload request");
    expect(html).toContain("The order is deferred after confirmation.");
  });

  it("blocks concurrent and held attempts; retries a rejected reversal", async () => {
    const value = snapshot();
    await repository.replaceSnapshot(value, userId);
    const attempts = await Promise.allSettled([
      saveDraft(repository, input(value), 1000),
      saveDraft(repository, input(value), 1000),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const draft = (await db.meta.where("key").startsWith("loaderDraft:").toArray())[0]!.value as Awaited<
      ReturnType<typeof saveDraft>
    >;
    await promoteDraft(repository, draft.key, userId, 6000);
    await db.outbox.toCollection().modify({ state: "held" });
    await expect(saveDraft(repository, input(value), 7000)).rejects.toThrow("Already recorded");
    await db.outbox.toCollection().modify({ state: "rejected" });
    const retry = await saveDraft(repository, input(value), 8000);
    expect(retry.receipt.id).not.toBe(draft.receipt.id);
    expect(await promoteDraft(repository, retry.key, userId, 13000)).toBe(true);
    expect(await db.outbox.count()).toBe(2);
  });

  it("retains receipt through snapshot coverage and permits a later request", async () => {
    const value = snapshot("PLANNED");
    await repository.replaceSnapshot(value, userId);
    const draft = await saveDraft(repository, input(value), 1000);
    await promoteDraft(repository, draft.key, userId, 6000);
    await db.outbox
      .toCollection()
      .modify({ state: "acked", confirmationFeedHead: "20", confirmedAt: "2026-10-04T16:02:00Z" });
    const covered = structuredClone(value);
    const order = covered.scope.reversals[0]!;
    order.status = "PLANNED";
    order.pendingReversal = null;
    order.lines.forEach((line) => {
      line.qtyLoaded = 0;
    });
    covered.scope.trips = structuredClone(apiVariantFixtures.fieldSnapshot.LOADER.scope.trips);
    covered.scope.trips[0]!.stops[0]!.order = order;
    covered.scope.reversals = [];
    covered.feedCursor = "20";
    await repository.replaceSnapshot(covered, userId);
    expect(await db.outbox.count()).toBe(0);
    const receipt = (await db.value<FieldReceipt>(`fieldReceipt:${draft.receipt.id}`))!;
    expect(receipt.events[0]!.state).toBe("acked");
    await repository.replaceSnapshot({ ...value, feedCursor: "21" }, userId);
    const later = await saveDraft(repository, input({ ...value, feedCursor: "21" }), 7000);
    expect(later.receipt.id).not.toBe(draft.receipt.id);
  });

  it("rechecks request and owner, and preserves changed-plan drafts on cold resume", async () => {
    const value = snapshot();
    await repository.replaceSnapshot(value, userId);
    const wrongOwner = input(value);
    wrongOwner.receipt.userId = "another-loader";
    await expect(saveDraft(repository, wrongOwner, 1000)).rejects.toThrow("Plan changed before save");
    const noRequest = structuredClone(value);
    noRequest.scope.reversals[0]!.pendingReversal = null;
    await repository.replaceSnapshot(noRequest, userId);
    await expect(saveDraft(repository, input(value), 1000)).rejects.toThrow("Reversal unavailable");
    await repository.replaceSnapshot(value, userId);
    const draft = await saveDraft(repository, input(value), 1000);
    const name = db.name;
    db.close();
    db = new OfflineDatabase(name);
    repository = new FieldRepository(db);
    await repository.replaceSnapshot({ ...value, planVersion: value.planVersion! + 1 }, userId);
    expect(await promoteDraft(repository, draft.key, userId, 6000)).toBe(false);
    expect(await db.value(draft.key)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
    await repository.observeEpoch(value.resetEpoch + 1);
    expect(await db.value(draft.key)).toBeUndefined();
  });
});
