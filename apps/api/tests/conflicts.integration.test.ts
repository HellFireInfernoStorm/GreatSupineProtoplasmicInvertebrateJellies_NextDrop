// Sync conflicts (issue #54, spec/sync/recovery-and-conflicts.md §9.5, ADR 0040): classification, held events,
// dispatcher resolution, and random interleavings of offline batches and publishes.
import { randomUUID } from "node:crypto";
import { addDays, reduceOrder } from "@nextdrop/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { toRulesEvent } from "../src/modules/orders";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl) console.info("Skipping conflict tests: set TEST_DATABASE_URL to a disposable _test database.");

const PIN = "2468";
const PASSWORD = "demo-password";
const clock = new Date("2026-10-04T00:00:00.000Z");
const ids = {} as Record<"kandy" | "veh039" | "veh040" | "milk" | "dispatcher" | "out1" | "out2" | "out3", string>;

type Who = "sampath" | "sampath2" | "kumara" | "loader" | "nimal" | "colombo" | "store";
interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  deviceId: string;
  seq: number;
}
type Key = "A" | "B" | "C";
interface Scenario {
  date: string;
  dayId: string;
  version: number;
  trip: string;
  orders: Record<Key, { id: string; lineId: string }>;
}

async function seedReference(prisma: PrismaClient) {
  const district = (name: string, depot: string) =>
    prisma.district.create({
      data: {
        name,
        depot,
        roadClass: "hill",
        freeFlowKmh: 30,
        depotToDistrictKm: 70,
        depotToDistrictFreeflowMin: 120,
        interStopKm: 3,
        interStopFreeflowMin: 8,
      },
    });
  ids.kandy = (await district("Nuwara Eliya", "Kandy")).id;
  await district("Colombo", "Peliyagoda");
  for (const [key, displayId] of [
    ["out1", "OUT104"],
    ["out2", "OUT105"],
    ["out3", "OUT106"],
  ] as const) {
    ids[key] = (
      await prisma.outlet.create({
        data: {
          displayId,
          brand: "Fresh",
          depot: "Kandy",
          dockType: "rear_dock",
          parkingConstraint: "normal",
          windowOpen: 300,
          windowClose: 600,
          districtId: ids.kandy,
        },
      })
    ).id;
  }
  const vehicle = async (displayId: string, driver: string) =>
    (
      await prisma.vehicle.create({
        data: {
          displayId,
          type: "truck",
          temp: "reefer",
          weightCapKg: 3000,
          volumeCapM3: 20,
          fuelType: "diesel",
          kmPerL: 6,
          weeklyFuelQuotaL: 300,
          depot: "Kandy",
          driver_vehicleId: {
            create: { displayId: `DRV${displayId.slice(3)}`, name: driver, phone: "+94 77 000 0000" },
          },
        },
      })
    ).id;
  ids.veh039 = await vehicle("VEH039", "Sampath");
  ids.veh040 = await vehicle("VEH040", "Kumara");
  ids.milk = (
    await prisma.product.create({
      data: {
        sku: "FR-MILK",
        name: "Milk",
        brand: "Fresh",
        tempRequirement: "chilled",
        unitLabel: "crate",
        unitWeightKg: 12,
        unitVolumeM3: "0.02",
      },
    })
  ).id;
  const pin = await hashSecret(PIN);
  const password = await hashSecret(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      { loginId: "LDR002", role: "LOADER", displayName: "Pradeep", passwordHash: pin, depot: "Kandy" },
      { loginId: "DRV039", role: "DRIVER", displayName: "Sampath", passwordHash: pin, vehicleId: ids.veh039 },
      { loginId: "DRV040", role: "DRIVER", displayName: "Kumara", passwordHash: pin, vehicleId: ids.veh040 },
      { loginId: "OUT104", role: "STORE", displayName: "Ishara", passwordHash: password, outletId: ids.out1 },
      { loginId: "nimal@waypoint.test", role: "DISPATCHER", displayName: "Nimal", passwordHash: password },
      {
        loginId: "kamal@waypoint.test",
        role: "DISPATCHER",
        displayName: "Kamal",
        passwordHash: password,
        depot: "Peliyagoda",
      },
    ],
    select: { id: true, loginId: true },
  });
  ids.dispatcher = users.find((u) => u.loginId === "nimal@waypoint.test")!.id;
}

describe.skipIf(!testDatabaseUrl)("sync conflicts against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<Who, Session>;
  let days = 0;
  let displayIds = 0;

  async function signIn(who: Who, payload: Record<string, string>) {
    const deviceId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: payload.pin ? { ...payload, deviceId } : payload,
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.statusCode, res.body).toBe(200);
    sessions[who] = {
      cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value,
      csrf: res.json().csrfToken,
      userId: res.json().user.id,
      deviceId,
      seq: 0,
    };
  }

  const serverEvent = (orderId: string) => ({
    source: "SERVER" as const,
    actorRole: "DISPATCHER" as const,
    actorUserId: ids.dispatcher,
    orderId,
    capturedAt: clock,
  });

  /** A trip's Kandy day with orders A, B and C planned on VEH039 (version 1), and its snapshot. */
  async function scenario(): Promise<Scenario> {
    const date = addDays("2026-10-05", days++);
    const day = await prisma.planningDay.create({
      data: { depot: "Kandy", date: new Date(date), state: "PUBLISHED", currentVersion: 0 },
    });
    const trip = await tripOn(day.id, ids.veh039);
    const orders = {} as Scenario["orders"];
    for (const [i, key] of (["A", "B", "C"] as const).entries()) {
      const order = await prisma.order.create({
        data: {
          displayId: `ORD${20000 + displayIds++}`,
          brand: "Fresh",
          tempRequirement: "chilled",
          requestedDate: new Date(date),
          currentDate: new Date(date),
          status: "PLANNED",
          weightG: 12000,
          volumeL: 20,
          idempotencyKey: randomUUID(),
          outletId: [ids.out1, ids.out2, ids.out3][i]!,
          orderLine_orderId: {
            create: [{ productId: ids.milk, qtyOrdered: 10, unitWeightKg: 12, unitVolumeM3: "0.02" }],
          },
        },
        include: { orderLine_orderId: true },
      });
      const lineId = order.orderLine_orderId[0]!.id;
      await prisma.orderEvent.create({
        data: {
          ...serverEvent(order.id),
          type: "ORDER_PLACED",
          payload: { requestedDate: date, lines: [{ lineId, skuId: "FR-MILK", qty: 10 }] },
        },
      });
      orders[key] = { id: order.id, lineId };
    }
    const sc: Scenario = { date, dayId: day.id, version: 0, trip, orders };
    await publish(sc, { A: ids.veh039, B: ids.veh039, C: ids.veh039 });
    return sc;
  }

  async function tripOn(dayId: string, vehicleId: string) {
    const existing = await prisma.trip.findFirst({ where: { planningDayId: dayId, vehicleId, tripNo: 1 } });
    if (existing) return existing.id;
    return (
      await prisma.trip.create({
        data: {
          displayId: `T${9000 + displayIds++}`,
          tripNo: 1,
          brand: "Fresh",
          plannedDepart: 210,
          plannedMinutes: 240,
          km: 120,
          litres: 20,
          planningDayId: dayId,
          vehicleId,
          districtId: ids.kandy,
        },
      })
    ).id;
  }

  /**
   * A stand-in for the publish transaction (#48) with the writes classification reads: stops moved or removed,
   * ORDER_PLANNED / ORDER_DEFERRED events, the next PlanVersion with its trip snapshot, and PlanVersionChange rows.
   * `plan` maps an order to its vehicle, or "DEFER".
   */
  async function publish(sc: Scenario, plan: Partial<Record<Key, string | "DEFER">>) {
    const version = sc.version + 1;
    const changes: { orderId: string; tripId: string | null; change: "ADDED" | "MOVED_VEHICLE" | "DEFERRED" }[] = [];
    for (const [key, target] of Object.entries(plan) as [Key, string][]) {
      const { id } = sc.orders[key];
      const stop = await prisma.tripStop.findFirst({ where: { orderId: id }, include: { trip: true } });
      if (target === "DEFER") {
        if (stop) await prisma.tripStop.delete({ where: { id: stop.id } });
        const toDate = addDays(sc.date, 1);
        await prisma.orderEvent.create({
          data: {
            ...serverEvent(id),
            type: "ORDER_DEFERRED",
            payload: {
              reasonCode: "TIME_BUDGET",
              causeKind: "CHOICE",
              scoreInputs: null,
              toDate,
              daysUnserved: 0,
              consecutiveDeferrals: 1,
              note: "",
              decidedBy: "DISPATCHER",
              planVersion: version,
            },
          },
        });
        await prisma.order.update({ where: { id }, data: { status: "DEFERRED", currentDate: new Date(toDate) } });
        changes.push({ orderId: id, tripId: stop?.tripId ?? null, change: "DEFERRED" });
        continue;
      }
      if (stop?.trip.vehicleId === target) continue;
      const tripId = await tripOn(sc.dayId, target);
      if (stop) await prisma.tripStop.delete({ where: { id: stop.id } });
      const seq = (await prisma.tripStop.count({ where: { tripId } })) + 1;
      await prisma.tripStop.create({
        data: { tripId, seq, etaMin: 400 + seq * 20, windowOpen: 300, windowClose: 600, serviceMin: 15, orderId: id },
      });
      await prisma.orderEvent.create({
        data: {
          ...serverEvent(id),
          type: "ORDER_PLANNED",
          payload: {
            tripId,
            vehicleId: target,
            seq: seq - 1,
            etaFrom: clock.toISOString(),
            etaTo: clock.toISOString(),
            planVersion: version,
          },
        },
      });
      await prisma.order.update({ where: { id }, data: { status: "PLANNED" } });
      changes.push({ orderId: id, tripId, change: stop ? "MOVED_VEHICLE" : "ADDED" });
    }
    const trips = await prisma.trip.findMany({
      where: { planningDayId: sc.dayId },
      include: { stops: { orderBy: { seq: "asc" } } },
    });
    const saved = await prisma.planVersion.create({
      data: {
        planningDayId: sc.dayId,
        version,
        draftRevision: version,
        publishedBy: ids.dispatcher,
        summary: {},
        snapshot: {
          trips: trips.map((t) => ({
            id: t.id,
            vehicleId: t.vehicleId,
            stops: t.stops.map((s) => ({ id: s.id, order: { id: s.orderId } })),
          })),
          deferrals: [],
        },
      },
    });
    if (changes.length) {
      await prisma.planVersionChange.createMany({ data: changes.map((c) => ({ ...c, planVersionId: saved.id })) });
    }
    await prisma.planningDay.update({ where: { id: sc.dayId }, data: { currentVersion: version } });
    sc.version = version;
  }

  function ev(who: Who, sc: Scenario, type: string, subject: Record<string, string>, payload: unknown, v: number) {
    const s = sessions[who];
    return {
      clientEventId: randomUUID(),
      deviceId: s.deviceId,
      deviceSeq: s.seq++,
      schemaVersion: 1,
      subject,
      source: "FIELD",
      actor: { userId: s.userId, role: who === "loader" ? "LOADER" : "DRIVER" },
      // 06:30 Asia/Colombo on the scenario's day.
      capturedAt: `${sc.date}T01:00:00.000Z`,
      basedOnPlanVersion: v,
      type,
      payload,
    };
  }
  const departed = (sc: Scenario, v: number) =>
    ev("sampath", sc, "TRIP_DEPARTED", { tripId: sc.trip }, { tripId: sc.trip }, v);
  /** Arrival, full delivery and proof for one order, from `who`'s device, as captured under version v. */
  const delivery = (sc: Scenario, key: Key, v: number, who: Who = "sampath", subject: Record<string, string> = {}) => {
    const s = { orderId: sc.orders[key].id, ...subject };
    return [
      ev(who, sc, "STOP_ARRIVED", s, { orderId: sc.orders[key].id }, v),
      ev(
        who,
        sc,
        "STOP_OUTCOME",
        s,
        { outcome: "FULL", lines: [{ lineId: sc.orders[key].lineId, qtyDelivered: 10 }] },
        v,
      ),
      ev(who, sc, "POD_CAPTURED", s, { receiverName: "Ishara", photoBlobRefs: [randomUUID()] }, v),
    ];
  };
  async function push(who: Who, events: unknown[]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/events",
      payload: { deviceId: sessions[who].deviceId, events },
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: { [CSRF_HEADER]: sessions[who].csrf },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().results as { status: string; code?: string; conflictId?: string; serverEventId?: string }[];
  }
  const resolve = (who: Who, conflictId: string, resolution: string, note?: string) =>
    app.inject({
      method: "POST",
      url: `/api/dispatch/conflicts/${conflictId}/resolve`,
      payload: { resolution, ...(note ? { note } : {}) },
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: { [CSRF_HEADER]: sessions[who].csrf },
    });
  const order = (id: string) =>
    prisma.order.findUniqueOrThrow({ where: { id }, include: { orderLine_orderId: true, orderEvent_orderId: true } });

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue54");
    prisma = suite.prisma;
    await seedReference(prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    await signIn("sampath", { role: "DRIVER", loginId: "DRV039", pin: PIN });
    await signIn("sampath2", { role: "DRIVER", loginId: "DRV039", pin: PIN });
    await signIn("kumara", { role: "DRIVER", loginId: "DRV040", pin: PIN });
    await signIn("loader", { role: "LOADER", loginId: "LDR002", pin: PIN });
    await signIn("store", { role: "STORE", loginId: "OUT104", password: PASSWORD });
    await signIn("nimal", { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Kandy" });
    await signIn("colombo", {
      role: "DISPATCHER",
      email: "kamal@waypoint.test",
      password: PASSWORD,
      depot: "Peliyagoda",
    });
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it("holds an offline delivery on a stop the dispatcher cancelled, and applies it once accepted (walkthrough 10-12)", async () => {
    const sc = await scenario();
    // Offline under v1: depart, then deliver A. Meanwhile the dispatcher cancels A's stop (v2).
    const offline = [departed(sc, 1), ...delivery(sc, "A", 1)];
    await publish(sc, { A: "DEFER" });
    const results = await push("sampath", offline);
    expect(results.map((r) => r.status)).toEqual(["ACCEPTED", "HELD_CONFLICT", "HELD_CONFLICT", "HELD_CONFLICT"]);

    const conflicts = await prisma.conflict.findMany({
      where: { orderId: sc.orders.A.id },
      include: { heldEvent: true },
      orderBy: { openedAt: "asc" },
    });
    expect(conflicts).toHaveLength(3);
    for (const c of conflicts) {
      expect(c).toMatchObject({ kind: "FACT_ON_CANCELLED_STOP", state: "OPEN", tripId: sc.trip });
      expect(c.heldEvent.disposition).toBe("HELD");
    }
    expect(new Set(conflicts.map((c) => c.id))).toEqual(new Set(results.slice(1).map((r) => r.conflictId)));
    // Not auto-resolved: the order stays deferred, and the dispatcher is told.
    let a = await order(sc.orders.A.id);
    expect(a.status).toBe("DEFERRED");
    expect(a.orderEvent_orderId.filter((e) => e.type === "CONFLICT_OPENED")).toHaveLength(3);
    const notices = await prisma.notification.findMany({ where: { userId: ids.dispatcher, kind: "conflict_opened" } });
    expect(notices.length).toBeGreaterThanOrEqual(3);
    expect(await prisma.changeFeed.count({ where: { kind: "conflict_opened", entityId: conflicts[0]!.id } })).toBe(1);

    // A retry reports the same conflict instead of a plain duplicate.
    expect((await push("sampath", [offline[2]]))[0]).toMatchObject({
      status: "HELD_CONFLICT",
      conflictId: results[2]!.conflictId,
    });

    const outcome = conflicts.find((x) => x.heldEvent.type === "STOP_OUTCOME")!;
    const res = await resolve("nimal", outcome.id, "ACCEPT_FACT", "Delivered before the cancel reached the van");
    expect(res.statusCode, res.body).toBe(200);
    a = await order(sc.orders.A.id);
    expect(a.status).toBe("DELIVERED");
    expect(a.confirmedAt).not.toBeNull();
    expect(a.orderLine_orderId[0]!.qtyDelivered).toBe(10);
    const resolved = a.orderEvent_orderId.find((e) => e.type === "CONFLICT_RESOLVED")!;
    expect(resolved.payload).toMatchObject({ resolution: "ACCEPT_FACT", heldEventId: outcome.heldEventId });
    // The store hears about the delivery once the fact is accepted.
    const store = await prisma.notification.findMany({ where: { kind: "delivered", userId: sessions.store.userId } });
    expect(store.filter((n) => (n.entityRef as { id?: string }).id === sc.orders.A.id)).toHaveLength(1);
    // The capture time is kept on the held fact.
    expect(outcome.heldEvent.capturedAt.toISOString()).toBe(`${sc.date}T01:00:00.000Z`);
    expect(
      reduceOrder(a.id, a.orderEvent_orderId.sort((a, b) => a.id.localeCompare(b.id)).map(toRulesEvent)).status,
    ).toBe("DELIVERED");
  });

  it("holds a delivery on a stop moved to another vehicle; a rejected fact stays recorded but inert", async () => {
    const sc = await scenario();
    const offline = [departed(sc, 1), ...delivery(sc, "B", 1, "sampath", { tripId: sc.trip })];
    await publish(sc, { B: ids.veh040 });
    const results = await push("sampath", offline);
    expect(results.map((r) => r.status)).toEqual(["ACCEPTED", "HELD_CONFLICT", "HELD_CONFLICT", "HELD_CONFLICT"]);
    const held = await prisma.conflict.findMany({ where: { orderId: sc.orders.B.id } });
    expect(held.every((c) => c.kind === "FACT_ON_REASSIGNED_STOP")).toBe(true);

    for (const conflict of held) {
      expect((await resolve("nimal", conflict.id, "REJECT_FACT")).statusCode).toBe(200);
    }
    const b = await order(sc.orders.B.id);
    expect(b.status).toBe("PLANNED");
    expect(b.orderLine_orderId[0]!.qtyDelivered).toBe(0);
    expect(b.orderEvent_orderId.filter((e) => e.disposition === "HELD")).toHaveLength(3);
    expect(
      await prisma.conflict.count({ where: { orderId: sc.orders.B.id, state: "RESOLVED", resolution: "REJECT_FACT" } }),
    ).toBe(3);
    // The departure took A and C out, not B.
    expect((await order(sc.orders.A.id)).status).toBe("OUT_FOR_DELIVERY");
  });

  it("holds a second device's outcome for the same stop as DUPLICATE_DELIVERY_FACT", async () => {
    const sc = await scenario();
    expect((await push("sampath", [departed(sc, 1), ...delivery(sc, "A", 1)])).map((r) => r.status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    const second = delivery(sc, "A", 1, "sampath2");
    const results = await push("sampath2", second);
    // The second arrival is harmless; its outcome and proof clash with the first device's.
    expect(results.map((r) => r.status)).toEqual(["ACCEPTED", "HELD_CONFLICT", "HELD_CONFLICT"]);
    const kinds = await prisma.conflict.findMany({ where: { orderId: sc.orders.A.id }, select: { kind: true } });
    expect(kinds.map((k) => k.kind)).toEqual(["DUPLICATE_DELIVERY_FACT", "DUPLICATE_DELIVERY_FACT"]);
    expect((await order(sc.orders.A.id)).status).toBe("DELIVERED");
  });

  it("holds a load against a changed plan as LOAD_AGAINST_CHANGED_PLAN", async () => {
    const sc = await scenario();
    const load = ev(
      "loader",
      sc,
      "LOAD_CONFIRMED",
      { orderId: sc.orders.B.id },
      { lines: [{ lineId: sc.orders.B.lineId, qtyLoaded: 10 }] },
      1,
    );
    await publish(sc, { B: "DEFER" });
    const [result] = await push("loader", [load]);
    expect(result).toMatchObject({ status: "HELD_CONFLICT" });
    expect(await prisma.conflict.findUniqueOrThrow({ where: { id: result!.conflictId! } })).toMatchObject({
      kind: "LOAD_AGAINST_CHANGED_PLAN",
      state: "OPEN",
    });
    const b = await order(sc.orders.B.id);
    expect(b.status).toBe("DEFERRED");
    expect(b.orderLine_orderId[0]!.qtyLoaded).toBe(0);
    // The same load under the current version, for an order still on the plan, applies.
    expect(
      (
        await push("loader", [
          ev(
            "loader",
            sc,
            "LOAD_CONFIRMED",
            { orderId: sc.orders.A.id },
            { lines: [{ lineId: sc.orders.A.lineId, qtyLoaded: 10 }] },
            sc.version,
          ),
        ])
      )[0]!.status,
    ).toBe("ACCEPTED");
  });

  it("holds an illegal delivery fact as ILLEGAL_TRANSITION and applies it on acceptance", async () => {
    const sc = await scenario();
    // The departure never reached the server, so the order is still PLANNED when its delivery arrives.
    const outcome = ev(
      "sampath",
      sc,
      "STOP_OUTCOME",
      { orderId: sc.orders.A.id },
      { outcome: "FULL", lines: [{ lineId: sc.orders.A.lineId, qtyDelivered: 9 }] },
      1,
    );
    const [result] = await push("sampath", [outcome]);
    expect(result).toMatchObject({ status: "HELD_CONFLICT" });
    const conflict = await prisma.conflict.findUniqueOrThrow({ where: { id: result!.conflictId! } });
    expect(conflict.kind).toBe("ILLEGAL_TRANSITION");
    expect((await order(sc.orders.A.id)).status).toBe("PLANNED");

    expect((await resolve("nimal", conflict.id, "ACCEPT_FACT")).statusCode).toBe(200);
    const a = await order(sc.orders.A.id);
    expect(a.status).toBe("DELIVERED");
    expect(a.orderLine_orderId[0]!.qtyDelivered).toBe(9);
  });

  it("applies non-fact events on changed stops, and refuses a driver who never had the stop", async () => {
    const sc = await scenario();
    await publish(sc, { C: "DEFER" });
    const ack = ev("sampath", sc, "PLAN_ACKNOWLEDGED", { tripId: sc.trip }, { planVersion: 1 }, 1);
    expect((await push("sampath", [ack]))[0]!.status).toBe("ACCEPTED");
    // VEH040's driver never had C: no conflict, a plain refusal.
    const foreign = delivery(sc, "C", 1, "kumara");
    expect((await push("kumara", foreign.slice(0, 1)))[0]).toMatchObject({ status: "REJECTED", code: "NOT_ASSIGNED" });
    expect(await prisma.conflict.count({ where: { orderId: sc.orders.C.id } })).toBe(0);
  });

  it("makes resolution idempotent, final, and dispatcher-only within the depot", async () => {
    const sc = await scenario();
    const offline = [departed(sc, 1), ...delivery(sc, "C", 1)];
    await publish(sc, { C: "DEFER" });
    const conflictId = (await push("sampath", offline))[2]!.conflictId!;

    expect((await resolve("sampath", conflictId, "ACCEPT_FACT")).statusCode).toBe(403);
    expect((await resolve("colombo", conflictId, "ACCEPT_FACT")).statusCode).toBe(403);
    expect((await resolve("nimal", randomUUID(), "ACCEPT_FACT")).statusCode).toBe(404);
    expect((await resolve("nimal", conflictId, "MAYBE")).statusCode).toBe(400);

    expect((await resolve("nimal", conflictId, "REJECT_FACT")).statusCode).toBe(200);
    const events = (await order(sc.orders.C.id)).orderEvent_orderId.length;
    // The same decision again changes nothing; a different one is refused.
    expect((await resolve("nimal", conflictId, "REJECT_FACT")).statusCode).toBe(200);
    expect((await order(sc.orders.C.id)).orderEvent_orderId).toHaveLength(events);
    const change = await resolve("nimal", conflictId, "ACCEPT_FACT");
    expect(change.statusCode).toBe(409);
    expect(change.json()).toMatchObject({ code: "ILLEGAL_TRANSITION" });
    expect((await order(sc.orders.C.id)).status).toBe("DEFERRED");
  });

  let heldInRandomRuns = 0;

  /** Mulberry32: a small seeded PRNG, so a failing interleaving can be replayed from its seed. */
  function prng(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  describe("field outcomes of held facts (issue #97, ADR 0042)", () => {
    const outcomes = (who: Who, clientEventIds: string[], headers: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url: "/api/sync/conflicts",
        payload: { clientEventIds },
        cookies: { [SESSION_COOKIE]: sessions[who].cookie },
        headers: { [CSRF_HEADER]: sessions[who].csrf, ...headers },
      });
    const get = (who: Who, url: string) =>
      app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: sessions[who].cookie } });
    type Item = { clientEventId: string; conflictId: string; state: string; resolution?: string; note?: string };
    const byEvent = (items: Item[]) => new Map(items.map((item) => [item.clientEventId, item]));

    it("returns only the caller's own held facts, decided or not, with a covering confirmation boundary", async () => {
      const sc = await scenario();
      const offline = [departed(sc, 1), ...delivery(sc, "A", 1)];
      await publish(sc, { A: "DEFER" });
      const results = await push("sampath", offline);
      expect(results.map((r) => r.status)).toEqual(["ACCEPTED", "HELD_CONFLICT", "HELD_CONFLICT", "HELD_CONFLICT"]);
      const [, arrival, outcome, proof] = offline.map((e) => e.clientEventId) as [string, string, string, string];
      const asked = [offline[0]!.clientEventId, arrival, outcome, proof, randomUUID()];

      // Applied and unknown IDs are left out; the held ones are open and name the conflict the push returned.
      let res = await outcomes("sampath", asked);
      expect(res.statusCode, res.body).toBe(200);
      let items = byEvent(res.json().items);
      expect([...items.keys()].sort()).toEqual([arrival, outcome, proof].sort());
      for (const [i, id] of [arrival, outcome, proof].entries()) {
        expect(items.get(id)).toEqual({
          conflictId: results[i + 1]!.conflictId,
          clientEventId: id,
          kind: "FACT_ON_CANCELLED_STOP",
          openedAt: expect.any(String),
          state: "OPEN",
        });
      }

      // Scope: the same user on another device sees them; another driver and the loader see nothing.
      expect((await outcomes("sampath2", asked)).json().items).toHaveLength(3);
      expect((await outcomes("kumara", asked)).json().items).toEqual([]);
      expect((await outcomes("loader", asked)).json().items).toEqual([]);
      for (const who of ["store", "nimal"] as const) {
        const denied = await outcomes(who, asked);
        expect(denied.statusCode).toBe(403);
        expect(denied.json().code).toBe("FORBIDDEN");
      }
      expect((await outcomes("sampath", asked, { [CSRF_HEADER]: "nope" })).statusCode).toBe(403);
      expect((await outcomes("sampath", [])).statusCode).toBe(400);
      expect(
        (
          await outcomes(
            "sampath",
            Array.from({ length: 101 }, () => randomUUID()),
          )
        ).statusCode,
      ).toBe(400);

      // The device then misses the hints: its feed cursor moves past both decisions before it asks.
      const note = "Proof photo does not match the outlet";
      expect((await resolve("nimal", results[2]!.conflictId!, "ACCEPT_FACT")).statusCode).toBe(200);
      expect((await resolve("nimal", results[1]!.conflictId!, "REJECT_FACT", note)).statusCode).toBe(200);
      const head = (await get("sampath", "/api/changes?after=0&limit=1")).json().head as string;
      expect((await get("sampath", `/api/changes?after=${head}`)).json().items).toEqual([]);

      res = await outcomes("sampath", asked);
      items = byEvent(res.json().items);
      expect(items.get(outcome)).toMatchObject({ state: "RESOLVED", resolution: "ACCEPT_FACT", note: null });
      expect(items.get(arrival)).toMatchObject({ state: "RESOLVED", resolution: "REJECT_FACT", note });
      expect(items.get(arrival)).toHaveProperty("resolvedAt", clock.toISOString());
      expect(items.get(proof)).toMatchObject({ state: "OPEN" });
      expect(items.get(proof)).not.toHaveProperty("resolution");

      // The boundary covers both decisions' feed rows, and a snapshot at or past it shows the accepted delivery.
      const boundary = BigInt(res.json().feedHead);
      const rows = await prisma.changeFeed.findMany({
        where: { kind: "conflict_resolved", entityId: { in: [results[1]!.conflictId!, results[2]!.conflictId!] } },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.seq <= boundary).toBe(true);
      expect((await order(sc.orders.A.id)).status).toBe("DELIVERED");
      const snapshot = (await get("sampath", `/api/field/snapshot?date=${sc.date}`)).json();
      expect(BigInt(snapshot.feedCursor) >= boundary).toBe(true);

      // Retries are stable: asking again, or the dispatcher repeating a decision, changes nothing.
      expect((await resolve("nimal", results[2]!.conflictId!, "ACCEPT_FACT")).statusCode).toBe(200);
      expect((await outcomes("sampath", asked)).json().items).toEqual(res.json().items);
    });
  });

  it.each(Array.from({ length: 8 }, (_, i) => i + 1))(
    "keeps the invariants under a random interleaving of offline batches and publishes (seed %i)",
    async (seed) => {
      const random = prng(seed);
      const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
      const sc = await scenario();
      // What the driver's phone believes: the version it last saw and the orders on its trip.
      let known = 1;
      let believed: Key[] = ["A", "B", "C"];
      const progress: Record<Key, number> = { A: 0, B: 0, C: 0 };
      let outbox: ReturnType<typeof ev>[] = [departed(sc, 1)];
      const pushed: { id: string; status: string }[] = [];

      const sync = async () => {
        if (outbox.length === 0) return;
        const results = await push("sampath", outbox);
        results.forEach((r, i) => pushed.push({ id: outbox[i]!.clientEventId, status: r.status }));
        outbox = [];
        // After a sync the phone installs a fresh snapshot.
        known = sc.version;
        const stops = await prisma.tripStop.findMany({ where: { tripId: sc.trip }, select: { orderId: true } });
        believed = (["A", "B", "C"] as const).filter((k) => stops.some((s) => s.orderId === sc.orders[k].id));
      };

      for (let step = 0; step < 10; step++) {
        const op = pick(["capture", "capture", "sync", "publish"] as const);
        if (op === "capture") {
          const open = believed.filter((k) => progress[k] < 3);
          if (open.length === 0) continue;
          const key = pick(open);
          outbox.push(delivery(sc, key, known)[progress[key]++]!);
        } else if (op === "sync") {
          await sync();
        } else {
          // The real publish refuses locked stops: delivery facts applied, or a departed trip (ADR 0037).
          const movable: Key[] = [];
          for (const key of ["A", "B", "C"] as const) {
            const o = await prisma.order.findUniqueOrThrow({
              where: { id: sc.orders[key].id },
              include: { tripStop_orderId: { include: { trip: true } }, orderEvent_orderId: true },
            });
            const stop = o.tripStop_orderId[0];
            const facts = o.orderEvent_orderId.some(
              (e) => e.disposition === "APPLIED" && ["STOP_ARRIVED", "STOP_OUTCOME", "POD_CAPTURED"].includes(e.type),
            );
            if (stop && stop.trip.status === "PLANNED" && !facts) movable.push(key);
          }
          if (movable.length === 0) continue;
          const key = pick(movable);
          await publish(sc, { [key]: random() < 0.5 ? "DEFER" : ids.veh040 });
        }
      }
      await sync();

      // No lost events: every fact is accepted, a duplicate of one, or held. None is rejected or dropped.
      expect(pushed.every((p) => ["ACCEPTED", "DUPLICATE", "HELD_CONFLICT"].includes(p.status))).toBe(true);
      const stored = await prisma.orderEvent.findMany({
        where: { clientEventId: { in: pushed.map((p) => p.id) } },
        include: { conflict_heldEventId: true },
      });
      expect(stored).toHaveLength(pushed.length);
      // No clash is auto-resolved: every held fact has its own open conflict, and nobody resolved anything yet.
      heldInRandomRuns += stored.filter((s) => s.disposition === "HELD").length;
      for (const e of stored.filter((s) => s.disposition === "HELD")) {
        expect(e.conflict_heldEventId?.state).toBe("OPEN");
      }
      const orderIds = Object.values(sc.orders).map((o) => o.id);
      expect(await prisma.orderEvent.count({ where: { orderId: { in: orderIds }, type: "CONFLICT_RESOLVED" } })).toBe(
        0,
      );

      // The dispatcher decides every clash; each order's projection then converges on its event log.
      const open = await prisma.conflict.findMany({ where: { orderId: { in: orderIds }, state: "OPEN" } });
      for (const conflict of open) {
        const res = await resolve("nimal", conflict.id, random() < 0.5 ? "ACCEPT_FACT" : "REJECT_FACT");
        expect(res.statusCode, res.body).toBe(200);
      }
      for (const id of orderIds) {
        const o = await order(id);
        const state = reduceOrder(id, o.orderEvent_orderId.sort((a, b) => a.id.localeCompare(b.id)).map(toRulesEvent));
        expect(o.status, `order ${id} (seed ${seed})`).toBe(state.status);
        expect(Object.keys(state.held)).toEqual([]);
        expect(Object.keys(state.conflicts)).toEqual([]);
      }
    },
  );

  it("produced clashes in the random runs, so their invariants were exercised", () => {
    expect(heldInRandomRuns).toBeGreaterThan(0);
  });
});
