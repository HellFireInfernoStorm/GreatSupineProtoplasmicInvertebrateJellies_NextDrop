import { apiVariantFixtures, fieldConflictContextFixture, type FieldSnapshot } from "@nextdrop/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase, type FieldReceipt } from "../../sync/database";
import { FieldRepository } from "../../sync/repository";
import {
  recordsReceived,
  deliveryDone,
  deliveryIntents,
  deliveryKey,
  groupStops,
  receiptEvents,
  savedDeliveryCount,
} from "./model";

let db: OfflineDatabase;
let repository: FieldRepository;
let snapshot: FieldSnapshot;
beforeEach(async () => {
  db = new OfflineDatabase(`driver-${uuidv7()}`);
  repository = new FieldRepository(db);
  snapshot = structuredClone(apiVariantFixtures.fieldSnapshot.DRIVER);
  await db.set("deviceId", uuidv7());
  await repository.replaceSnapshot(snapshot, "driver-1");
});
afterEach(async () => db.delete());
const input = () => {
  const trip = snapshot.scope.trips[0]!;
  const stop = trip.stops[0]!;
  stop.order.status = "OUT_FOR_DELIVERY";
  stop.order.lines[0]!.qtyLoaded = 4;
  return {
    trip,
    stop,
    userId: "driver-1",
    outcome: "FULL" as const,
    quantities: {},
    reason: "",
    receiver: " Nimal ",
    photos: [uuidv7()],
  };
};
const receipt = (): Omit<FieldReceipt, "events"> => ({
  id: deliveryKey("driver-1", snapshot.resetEpoch, snapshot.scope.date, snapshot.scope.trips[0]!.stops[0]!.order.id),
  userId: "driver-1",
  resetEpoch: snapshot.resetEpoch,
  date: snapshot.scope.date,
  tripId: snapshot.scope.trips[0]!.id,
  orderId: snapshot.scope.trips[0]!.stops[0]!.order.id,
  kind: "DELIVERY",
  planVersion: snapshot.planVersion!,
});
it("groups only adjacent outlet stops within a trip, keeping every order", () => {
  const trip = snapshot.scope.trips[0]!;
  const a = trip.stops[0]!;
  const b = structuredClone(a);
  b.id = "stop-b";
  b.seq = a.seq + 1;
  b.order.id = "order-b";
  const c = structuredClone(a);
  c.id = "stop-c";
  c.seq = a.seq + 2;
  c.outlet.id = "elsewhere";
  const d = structuredClone(a);
  d.id = "stop-d";
  d.seq = a.seq + 3;
  trip.stops = [d, c, b, a];
  const second = { ...structuredClone(trip), id: "trip-2", tripNo: 2 as const, stops: [structuredClone(a)] };
  expect(groupStops([second, trip]).map((g) => g.stops.map((s) => s.id))).toEqual([
    [a.id, b.id],
    [c.id],
    [d.id],
    [a.id],
  ]);
});
it("reports full against loaded quantities and requires reason/photo for non-full outcomes", () => {
  const data = input();
  const events = deliveryIntents(data);
  expect(events[0]).toMatchObject({ payload: { outcome: "FULL", lines: [{ qtyDelivered: 4, qtyReturned: 0 }] } });
  expect(events[1]).toMatchObject({
    payload: { receiverName: "Nimal", photoBlobRefs: data.photos },
    blobRefs: data.photos,
  });
  const line = data.stop.order.lines[0]!.id;
  expect(deliveryIntents({ ...data, outcome: "PARTIAL", quantities: { [line]: 2 }, reason: "OTHER" })[0]).toMatchObject(
    { payload: { lines: [{ qtyDelivered: 2, qtyReturned: 2 }] } },
  );
  for (const outcome of ["REFUSED", "FAILED"] as const)
    expect(deliveryIntents({ ...data, outcome, reason: "OTHER" })[0]).toMatchObject({
      payload: { lines: [{ qtyDelivered: 0, qtyReturned: 4 }] },
    });
  expect(() => deliveryIntents({ ...data, outcome: "PARTIAL", quantities: { [line]: 5 }, reason: "OTHER" })).toThrow();
  expect(() => deliveryIntents({ ...data, outcome: "PARTIAL", quantities: { [line]: 4 }, reason: "OTHER" })).toThrow();
  expect(() =>
    deliveryIntents({ ...data, outcome: "REFUSED", signature: uuidv7(), photos: [], reason: "OTHER" }),
  ).toThrow();
  expect(() => deliveryIntents({ ...data, receiver: " " })).toThrow();
  expect(() => deliveryIntents({ ...data, photos: [] })).toThrow();
});
it("atomically saves outcome, proof and receipt, and survives cold resume", async () => {
  const data = input();
  const saved = receipt();
  const events = await repository.enqueueBatch(deliveryIntents(data), saved);
  expect(events.map((e) => e.deviceSeq)).toEqual([0, 1]);
  expect(savedDeliveryCount([{ ...saved, events }], events)).toBe(1);
  expect(deliveryDone(data.stop, { ...saved, events }, events)).toBe(true);
  db.close();
  db = new OfflineDatabase(db.name);
  expect(await db.value(`fieldReceipt:${saved.id}`)).toMatchObject({
    orderId: data.stop.order.id,
    events: [{ type: "STOP_OUTCOME" }, { type: "POD_CAPTURED" }],
  });
  await expect(new FieldRepository(db).enqueueBatch(deliveryIntents(data), saved)).rejects.toThrow("Already saved");
  expect(await db.outbox.count()).toBe(2);
});
it("rolls back the whole delivery and sequence when proof validation fails", async () => {
  const intents = deliveryIntents(input());
  // Simulate a corrupt proof at the storage boundary, after a valid outcome.
  intents[1] = { ...intents[1]!, payload: { receiverName: "", photoBlobRefs: [] } } as (typeof intents)[number];
  repository.onWrite = vi.fn();
  await expect(repository.enqueueBatch(intents, receipt())).rejects.toThrow();
  expect(await db.outbox.count()).toBe(0);
  expect(await db.value("deviceSeq")).toBeUndefined();
  expect(await db.value(`fieldReceipt:${receipt().id}`)).toBeUndefined();
  expect(repository.onWrite).not.toHaveBeenCalled();
});
it("rejects stale owner, epoch or plan saves without claiming a receipt", async () => {
  for (const changed of [
    { userId: "other" },
    { date: "2026-10-01" },
    { resetEpoch: snapshot.resetEpoch + 1 },
    { planVersion: snapshot.planVersion! + 1 },
  ]) {
    await expect(repository.enqueueBatch(deliveryIntents(input()), { ...receipt(), ...changed })).rejects.toThrow(
      "Run changed",
    );
  }
  await expect(repository.enqueueBatch(deliveryIntents({ ...input(), userId: "other" }), receipt())).rejects.toThrow(
    "Run changed",
  );
  expect(await db.outbox.count()).toBe(0);
});
it("retains confirmed receipt and plan acknowledgement after a covering snapshot, clears on reset", async () => {
  const saved = receipt();
  const events = await repository.enqueueBatch(deliveryIntents(input()), saved);
  const ackReceipt = { ...saved, id: "ack-current", kind: "PLAN_ACK" as const };
  const ack = await repository.enqueueBatch(
    [
      {
        type: "PLAN_ACKNOWLEDGED",
        subject: { vehicleId: snapshot.role === "DRIVER" ? snapshot.scope.vehicle.id : "vehicle" },
        actor: { userId: "driver-1", role: "DRIVER" },
        payload: { planVersion: snapshot.planVersion! },
      },
    ],
    ackReceipt,
  );
  for (const e of [...events, ...ack])
    await db.outbox.update(e.clientEventId, {
      state: "acked",
      confirmationFeedHead: snapshot.feedCursor,
      confirmedAt: snapshot.serverTime,
    });
  await repository.replaceSnapshot(snapshot, "driver-1");
  expect(await db.outbox.count()).toBe(0);
  const retained = await db.value<FieldReceipt>(`fieldReceipt:${saved.id}`);
  expect(receiptEvents(retained!, []).every((e) => e.state === "acked" && e.confirmedAt === snapshot.serverTime)).toBe(
    true,
  );
  expect(savedDeliveryCount([retained!], [])).toBe(0);
  expect((await db.value<FieldReceipt>(`fieldReceipt:${ackReceipt.id}`))?.events[0]).toMatchObject({
    state: "acked",
    confirmationFeedHead: snapshot.feedCursor,
  });
  await db.set("driverPlan:driver-1:current", snapshot.planVersion);
  await repository.observeEpoch(snapshot.resetEpoch + 1);
  expect(await db.value(`fieldReceipt:${saved.id}`)).toBeUndefined();
  expect(await db.value("driverPlan:driver-1:current")).toBeUndefined();
});
it("keeps held and rejected deliveries visible without projecting completion", async () => {
  const data = input(),
    saved = receipt();
  const events = await repository.enqueueBatch(deliveryIntents(data), saved);
  const durable = { ...saved, events };
  const held = events.map((e) => ({ ...e, state: "held" as const }));
  expect(deliveryDone(data.stop, durable, held)).toBe(false);
  expect(savedDeliveryCount([durable], held)).toBe(1);
  expect(
    deliveryDone(
      data.stop,
      durable,
      events.map((e) => ({ ...e, state: "rejected" as const })),
    ),
  ).toBe(false);
});

it("distinguishes received clashes from applied facts and waits for context, photos and snapshot confirmations", async () => {
  const events = await repository.enqueueBatch(deliveryIntents(input()), receipt());
  const state = {
    offline: false,
    syncing: false,
    error: null,
    pendingCount: 0,
    heldCount: 2,
    confirmationCount: 0,
    failedCount: 0,
    lastSyncedAt: snapshot.serverTime,
  };
  const held = events.map((e) => ({ ...e, state: "held" as const, confirmedAt: snapshot.serverTime }));
  expect(recordsReceived(state, held, [])).toBe(false);
  const conflicts = held.map((e) => ({
    id: uuidv7(),
    clientEventId: e.clientEventId,
    userId: "driver-1",
    context: structuredClone(fieldConflictContextFixture.context),
  }));
  expect(recordsReceived(state, held, conflicts)).toBe(true);
  for (const changed of [
    { offline: true },
    { syncing: true },
    { error: "No signal" },
    { pendingCount: 1 },
    { confirmationCount: 1 },
    { failedCount: 1 },
    { lastSyncedAt: null },
    { heldCount: 0 },
  ])
    expect(recordsReceived({ ...state, ...changed }, held, conflicts)).toBe(false);
  expect(
    recordsReceived(
      state,
      held.map((e) => ({ ...e, confirmedAt: undefined })),
      conflicts,
    ),
  ).toBe(false);
  expect(deliveryDone(input().stop, { ...receipt(), events: held }, held)).toBe(false);
});

it("treats received and cancelled orders as done without a local receipt", () => {
  const { stop } = input();
  for (const status of ["RECEIVED", "CANCELLED"] as const) {
    stop.order.status = status;
    expect(deliveryDone(stop, undefined, [])).toBe(true);
  }
});
