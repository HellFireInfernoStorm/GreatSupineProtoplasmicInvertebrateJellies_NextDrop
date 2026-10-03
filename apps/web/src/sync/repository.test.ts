import { apiFixtures, apiVariantFixtures, clientEventSchema, type FieldSnapshot } from "@nextdrop/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase } from "./database";
import { FieldRepository } from "./repository";

let db: OfflineDatabase;
let repository: FieldRepository;
const snapshot = (): FieldSnapshot => structuredClone(apiVariantFixtures.fieldSnapshot.DRIVER);
beforeEach(async () => {
  db = new OfflineDatabase(`repository-${uuidv7()}`);
  repository = new FieldRepository(db);
  await db.set("deviceId", uuidv7());
});

const intent = (orderId = apiFixtures.clientEvent.subject.orderId!) => ({
  type: "LOAD_CONFIRMED" as const,
  subject: { orderId },
  actor: { userId: "driver-1", role: "DRIVER" as const },
  payload: { lines: [{ lineId: "line-1", qtyLoaded: 2 }] },
});

describe("local repository", () => {
  it("allocates UUIDs and monotonic sequences atomically for simultaneous writes", async () => {
    await db.set("planVersion", 8);
    const entries = await Promise.all(Array.from({ length: 12 }, () => repository.enqueue(intent())));
    expect(entries.map((e) => e.deviceSeq).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(new Set(entries.map((e) => e.clientEventId)).size).toBe(12);
    expect(entries.every((e) => e.basedOnPlanVersion === 8 && e.state === "pending")).toBe(true);
    expect(clientEventSchema.safeParse(apiFixtures.clientEvent).success).toBe(true);
    db.close();
    const reopened = new OfflineDatabase(db.name);
    expect(await reopened.outbox.count()).toBe(12);
    expect(await reopened.value("deviceSeq")).toBe(12);
    await reopened.delete();
  });

  it("folds pending facts through the shared reducer, keeps confirmed and other-user facts out", async () => {
    const data = snapshot();
    const order = data.scope.trips[0]!.stops[0]!.order;
    order.status = "PLANNED";
    await repository.replaceSnapshot(data, "driver-1");
    await repository.enqueue(intent(order.id));
    expect((await repository.projectOrder(order.id, "driver-1"))?.status).toBe("LOADED");
    expect(await repository.projectOrder(order.id, "another-user")).toBeNull();
    await db.outbox.toCollection().modify({ state: "failed" });
    expect((await repository.projectOrder(order.id, "driver-1"))?.status).toBe("PLANNED");
    await db.delete();
  });

  it("projects a trip departure across its assigned orders", async () => {
    const data = snapshot();
    const trip = data.scope.trips[0]!;
    const order = trip.stops[0]!.order;
    order.status = "PLANNED";
    order.assignment = { ...apiFixtures.order.assignment!, tripId: trip.id };
    await repository.replaceSnapshot(data, "driver-1");
    await repository.enqueue({
      type: "TRIP_DEPARTED",
      subject: { tripId: trip.id },
      actor: intent().actor,
      payload: { tripId: trip.id },
    });
    expect((await repository.projectOrder(order.id, "driver-1"))?.status).toBe("OUT_FOR_DELIVERY");
    await db.delete();
  });

  it("ordinary refetch replaces server tables without touching pending work", async () => {
    const data = snapshot();
    await repository.replaceSnapshot(data, "driver-1");
    const entry = await repository.enqueue(intent());
    await repository.replaceSnapshot({ ...data, planVersion: 4 }, "driver-1");
    expect(await db.outbox.get(entry.clientEventId)).toEqual(entry);
    expect(await db.value("planVersion")).toBe(4);
    await db.delete();
  });

  it("reset clears old orders, conflicts and both queues but preserves device identity and session", async () => {
    await repository.replaceSnapshot(snapshot(), "driver-1");
    await repository.enqueue(intent());
    await db.set("localSession", { remembered: true });
    const deviceId = await db.value("deviceId");
    const oldEpoch = await db.value<number>("resetEpoch");
    expect(await repository.observeEpoch(oldEpoch! + 1)).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.orders.count()).toBe(0);
    expect(await db.value("deviceId")).toBe(deviceId);
    expect(await db.value("localSession")).toEqual({ remembered: true });
    expect(await db.value("resetNotice")).toMatchObject({ resetEpoch: oldEpoch! + 1 });
    await db.delete();
  });
});

it("records intent with no plan version rather than emitting an invalid null", async () => {
  await db.set("planVersion", null);
  const entry = await repository.enqueue(intent());
  expect(entry.basedOnPlanVersion).toBeUndefined();
  expect(entry.state).toBe("pending");
  await db.delete();
});

it("only prunes the current user's covered acknowledgements, preserving unresolved evidence", async () => {
  const data = snapshot();
  const rows = await Promise.all(Array.from({ length: 7 }, () => repository.enqueue(intent())));
  await db.outbox.update(rows[0]!.clientEventId, { state: "acked", confirmationFeedHead: data.feedCursor });
  await db.outbox.update(rows[1]!.clientEventId, {
    state: "acked",
    confirmationFeedHead: String(BigInt(data.feedCursor) + 1n),
  });
  await db.outbox.update(rows[2]!.clientEventId, { state: "acked" }); // no confirmation boundary: retain legacy data
  await db.outbox.update(rows[3]!.clientEventId, { state: "held" });
  await db.outbox.update(rows[4]!.clientEventId, { state: "failed" });
  await db.outbox.update(rows[5]!.clientEventId, {
    state: "acked",
    confirmationFeedHead: data.feedCursor,
    actor: { role: "DRIVER", userId: "other" },
  });
  await repository.replaceSnapshot(data, "driver-1");
  expect(await db.outbox.get(rows[0]!.clientEventId)).toBeUndefined();
  for (const row of rows.slice(1)) expect(await db.outbox.get(row.clientEventId)).toBeDefined();
  await db.delete();
});
