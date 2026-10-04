import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { apiVariantFixtures, type FieldSnapshot } from "@nextdrop/contracts";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase } from "../../sync/database";
import { FieldRepository } from "../../sync/repository";
import { loadIntents, loadOrder, tripGate, projectDrafts, loadTotals } from "./model";
import { loadKey, saveDraft, undoDraft, promoteDraft, queueReady } from "./drafts";
let db: OfflineDatabase;
let repository: FieldRepository;
const userId = "loader-1";
const snapshot = (): Extract<FieldSnapshot, { role: "LOADER" }> => {
  const value = structuredClone(apiVariantFixtures.fieldSnapshot.LOADER);
  const order = value.scope.trips[0]!.stops[0]!.order;
  order.status = "PLANNED";
  order.lines[0]!.qtyOrdered = 10;
  order.lines[0]!.qtyLoaded = 0;
  order.flags.short = [];
  order.flags.damaged = [];
  value.scope.trips[0]!.status = "PLANNED";
  return value;
};
beforeEach(async () => {
  db = new OfflineDatabase(`loader-${uuidv7()}`);
  repository = new FieldRepository(db);
  await db.set("deviceId", uuidv7());
});
afterEach(async () => {
  await db.delete();
});
async function stage(kind: "loaded" | "short" | "damaged", quantity = 0) {
  const value = snapshot();
  await repository.replaceSnapshot(value, userId);
  const trip = value.scope.trips[0]!;
  const stop = trip.stops[0]!;
  const line = stop.order.lines[0]!;
  const state = (await repository.projectOrder(stop.order.id, userId))!;
  const photoRef = uuidv7();
  const intents = loadIntents({
    trip,
    stop,
    line,
    state,
    userId,
    kind,
    quantity,
    reason: kind === "short" ? "STOCK_SHORT" : "CRUSHED",
    photoRef: kind === "damaged" ? photoRef : undefined,
  });
  const draft = await saveDraft(
    repository,
    {
      label: line.name,
      receipt: {
        id: loadKey(userId, value, stop.order.id, line.id),
        userId,
        resetEpoch: value.resetEpoch,
        date: value.scope.date,
        tripId: trip.id,
        orderId: stop.order.id,
        kind: "LOAD",
        planVersion: value.planVersion!,
      },
      intents,
      capturedAt: "2026-09-29T00:10:00Z",
      clockOffsetMs: 60000,
      ...(kind === "damaged"
        ? {
            blob: {
              clientBlobId: photoRef,
              userId,
              bytes: new Blob(["photo"]),
              state: "pending" as const,
              attempts: 0,
              lastError: null,
            },
          }
        : {}),
    },
    1000,
  );
  return { draft, trip, stop, value, state };
}
describe("Loader durable recording", () => {
  it("hand-over rechecks saved quantities and drafts, then records exactly one durable ready receipt", async () => {
    const { draft, value, trip } = await stage("loaded");
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Trip not ready");
    expect(await db.outbox.count()).toBe(0);
    await promoteDraft(repository, draft.key, userId, 7000);
    await queueReady(repository, userId, value, trip.id);
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Already saved");
    const events = await db.outbox.toArray();
    expect(events.filter((e) => e.type === "TRIP_READY")).toHaveLength(1);
    expect(events.find((e) => e.type === "TRIP_READY")?.subject).toEqual({
      tripId: trip.id,
      vehicleId: trip.vehicleId,
    });
    expect(
      await db.value(`fieldReceipt:ready:${userId}:${value.resetEpoch}:${value.scope.date}:${trip.id}`),
    ).toBeDefined();
  });
  it("hand-over rejects stale plans, other owners and unresolved shorts without recording a ready fact", async () => {
    const { draft, value, trip, stop } = await stage("short", 2);
    await promoteDraft(repository, draft.key, userId, 7000);
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Trip not ready");
    await expect(queueReady(repository, "another-loader", value, trip.id)).rejects.toThrow("Trip changed");
    stop.order.flags.short = [{ lineId: stop.order.lines[0]!.id, qtyShort: 2, resolution: "SHIP_PARTIAL" }];
    stop.order.lines[0]!.qtyLoaded = 8;
    await repository.replaceSnapshot({ ...value, planVersion: 3 }, userId);
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Trip changed");
    expect((await db.outbox.toArray()).some((e) => e.type === "TRIP_READY")).toBe(false);
  });
  it("loads in reverse sequence, keeps snapshots intact, and blocks untouched lines", async () => {
    const value = snapshot();
    const trip = value.scope.trips[0]!;
    const second = structuredClone(trip.stops[0]!);
    second.id = uuidv7();
    second.seq = 8;
    trip.stops.push(second);
    expect(loadOrder(trip).map((s) => s.seq)).toEqual([8, trip.stops[0]!.seq]);
    expect(trip.stops[0]!.id).not.toBe(second.id);
    trip.stops.pop();
    await repository.replaceSnapshot(value, userId);
    const state = (await repository.projectOrder(trip.stops[0]!.order.id, userId))!;
    expect(tripGate(trip, { [state.orderId]: state }).ready).toBe(false);
    trip.stops[0]!.order.lines[0]!.qtyLoaded = 10;
    await repository.replaceSnapshot(value, userId);
    const saved = (await repository.projectOrder(state.orderId, userId))!;
    expect(tripGate(trip, { [state.orderId]: saved }).ready).toBe(true);
  });
  it("Undo removes only its unsent draft; promotion retains original capture time and rejects duplicate saves", async () => {
    const { draft, state, trip } = await stage("loaded");
    expect(tripGate(trip, { [state.orderId]: projectDrafts(state, [draft]) }).ready).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(await promoteDraft(repository, draft.key, userId, 5999)).toBe(false);
    expect(await undoDraft(repository, draft.key, "another-loader", 2000)).toBe(false);
    expect(await undoDraft(repository, draft.key, userId, 2000)).toBe(true);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(false);
    await db.set(draft.key, draft);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(true);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(false);
    const events = await db.outbox.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]!.capturedAt).toBe(draft.capturedAt);
    expect(events[0]!.clockOffsetMs).toBe(60000);
    expect(await undoDraft(repository, draft.key, userId, 7000)).toBe(false);
    await expect(saveDraft(repository, draft, 8000)).rejects.toThrow("Already recorded");
  });
  it("short reports confirm the remaining load but wait for dispatcher approval", async () => {
    const { draft, state, trip } = await stage("short", 4);
    const projected = projectDrafts(state, [draft]);
    const gate = tripGate(trip, { [state.orderId]: projected });
    expect(projected.loaded[0]!.qtyLoaded).toBe(6);
    expect(gate.incompleteLines).toHaveLength(0);
    expect(gate.ready).toBe(false);
    expect(loadTotals(trip, { [state.orderId]: projected }).short).toBe(4);
    await promoteDraft(repository, draft.key, userId, 7000);
    const current = (await repository.projectOrder(state.orderId, userId))!;
    expect(current.short).toHaveLength(1);
    const approved = { ...current, short: current.short.map((l) => ({ ...l, resolution: "SHIP_PARTIAL" as const })) };
    expect(tripGate(trip, { [state.orderId]: approved }).ready).toBe(true);
    const held = { ...current, short: current.short.map((l) => ({ ...l, resolution: "HOLD_TRIP" as const })) };
    expect(tripGate(trip, { [state.orderId]: held }).ready).toBe(false);
  });
  it("damage and photo promote atomically; held/rejected reports stay inert", async () => {
    const { draft, state, trip } = await stage("damaged", 2);
    expect(await db.blobQueue.count()).toBe(0);
    await promoteDraft(repository, draft.key, userId, 7000);
    const events = await db.outbox.toArray();
    expect(events.map((e) => e.type)).toEqual(["LOAD_DAMAGED", "LOAD_CONFIRMED"]);
    expect(await db.blobQueue.count()).toBe(1);
    expect(events[0]!.payload).toMatchObject({ reasonCode: "CRUSHED", photoRef: draft.blob!.clientBlobId });
    const recorded = (await repository.projectOrder(state.orderId, userId))!;
    expect(tripGate(trip, { [state.orderId]: recorded }).ready).toBe(true);
    await db.outbox.toCollection().modify({ state: "held" });
    const held = (await repository.projectOrder(state.orderId, userId))!;
    expect(held.damaged).toHaveLength(0);
    expect(tripGate(trip, { [state.orderId]: held }).ready).toBe(false);
  });
  it("cold resume promotes once, preserves stale-plan drafts and clears them on reset", async () => {
    const { draft, value } = await stage("loaded");
    const name = db.name;
    db.close();
    db = new OfflineDatabase(name);
    repository = new FieldRepository(db);
    await repository.replaceSnapshot({ ...value, planVersion: 3 }, userId);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(false);
    expect(await db.value(draft.key)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
    await repository.replaceSnapshot(value, userId);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(true);
    await db.set(draft.key, draft);
    await db.set("loaderPlan:owner", 1);
    await repository.observeEpoch(value.resetEpoch + 1);
    expect(await db.value(draft.key)).toBeUndefined();
    expect(await db.value("loaderPlan:owner")).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
  it("snapshot coverage prunes receipts without doubling short flags or losing loaded totals", async () => {
    const { draft, value, stop, trip } = await stage("short", 4);
    await promoteDraft(repository, draft.key, userId, 7000);
    await db.outbox
      .toCollection()
      .modify({ state: "acked", confirmationFeedHead: "20", confirmedAt: "2026-09-29T01:00:00Z" });
    stop.order.flags.short = [{ lineId: stop.order.lines[0]!.id, qtyShort: 4, resolution: "SHIP_PARTIAL" }];
    stop.order.lines[0]!.qtyLoaded = 6;
    stop.order.status = "LOADED";
    await repository.replaceSnapshot({ ...value, feedCursor: "20" }, userId);
    expect(await db.outbox.count()).toBe(0);
    const projected = (await repository.projectOrder(stop.order.id, userId))!;
    expect(projected.short).toHaveLength(1);
    expect(projected.loaded[0]!.qtyLoaded).toBe(6);
    expect(tripGate(trip, { [projected.orderId]: projected }).ready).toBe(true);
    const receipt = await db.value<{ events: { state: string }[] }>(`fieldReceipt:${draft.receipt.id}`);
    expect(receipt?.events.every((e) => e.state === "acked")).toBe(true);
  });
});
