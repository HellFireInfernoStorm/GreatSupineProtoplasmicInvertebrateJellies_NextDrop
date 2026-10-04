import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping shortfall integration tests: set TEST_DATABASE_URL to a disposable _test database.");

const PIN = "2468";
const PASSWORD = "demo-password";
/** Sat 3 Oct 2026; Sun 4 Oct does not operate, so a Saturday order's next operating date is itself. */
const DATE = "2026-10-03";
const clock = new Date("2026-10-02T21:00:00.000Z");
const ids = {} as Record<"trip" | "orderA" | "orderB" | "milk" | "dispatcher" | "outlet", string>;
const lines = {} as Record<"aMilk" | "bMilk", string>;
type Who = "loader" | "nimal" | "colombo" | "store";

async function seed(prisma: PrismaClient) {
  const district = await prisma.district.create({
    data: {
      name: "Nuwara Eliya",
      depot: "Kandy",
      roadClass: "hill",
      freeFlowKmh: 30,
      depotToDistrictKm: 70,
      depotToDistrictFreeflowMin: 120,
      interStopKm: 3,
      interStopFreeflowMin: 8,
    },
  });
  ids.outlet = (
    await prisma.outlet.create({
      data: {
        displayId: "OUT108",
        brand: "Fresh",
        depot: "Kandy",
        dockType: "rear_dock",
        parkingConstraint: "normal",
        windowOpen: 300,
        windowClose: 480,
        districtId: district.id,
      },
    })
  ).id;
  const vehicle = await prisma.vehicle.create({
    data: {
      displayId: "VEH039",
      type: "truck",
      temp: "reefer",
      weightCapKg: 3000,
      volumeCapM3: 20,
      fuelType: "diesel",
      kmPerL: 6,
      weeklyFuelQuotaL: 300,
      depot: "Kandy",
      driver_vehicleId: { create: { displayId: "DRV039", name: "Sampath", phone: "+94 77 000 0000" } },
    },
  });
  ids.milk = (
    await prisma.product.create({
      data: {
        sku: "FR-MILK",
        name: "Milk",
        brand: "Fresh",
        tempRequirement: "chilled",
        unitLabel: "crate",
        unitWeightKg: "12.5",
        unitVolumeM3: "0.0205",
      },
    })
  ).id;
  const pin = await hashSecret(PIN);
  const password = await hashSecret(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      { loginId: "LDR002", role: "LOADER", displayName: "Pradeep", passwordHash: pin, depot: "Kandy" },
      {
        loginId: "nimal@waypoint.test",
        role: "DISPATCHER",
        displayName: "Nimal",
        passwordHash: password,
        depot: "Kandy",
      },
      {
        loginId: "colombo@waypoint.test",
        role: "DISPATCHER",
        displayName: "Colombo",
        passwordHash: password,
        depot: "Peliyagoda",
      },
      { loginId: "OUT108", role: "STORE", displayName: "Ishara", passwordHash: password, outletId: ids.outlet },
    ],
    select: { id: true, loginId: true },
  });
  ids.dispatcher = users.find((u) => u.loginId === "nimal@waypoint.test")!.id;
  const day = await prisma.planningDay.create({
    data: { depot: "Kandy", date: new Date(DATE), state: "PUBLISHED", currentVersion: 1 },
  });
  const trip = await prisma.trip.create({
    data: {
      displayId: "T001",
      tripNo: 1,
      brand: "Fresh",
      plannedDepart: 210,
      plannedMinutes: 240,
      km: 120,
      litres: 20,
      planningDayId: day.id,
      vehicleId: vehicle.id,
      districtId: district.id,
    },
  });
  ids.trip = trip.id;
  const order = async (displayId: string, seq: number) => {
    const created = await prisma.order.create({
      data: {
        displayId,
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date(DATE),
        currentDate: new Date(DATE),
        status: "PLANNED",
        weightG: 150000,
        volumeL: 246,
        idempotencyKey: randomUUID(),
        outletId: ids.outlet,
        orderLine_orderId: {
          create: [{ productId: ids.milk, qtyOrdered: 12, unitWeightKg: "12.5", unitVolumeM3: "0.0205" }],
        },
      },
      include: { orderLine_orderId: true },
    });
    const server = {
      source: "SERVER" as const,
      actorRole: "DISPATCHER" as const,
      actorUserId: ids.dispatcher,
      orderId: created.id,
    };
    const lineId = created.orderLine_orderId[0]!.id;
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLACED",
        capturedAt: clock,
        payload: { requestedDate: DATE, lines: [{ lineId, skuId: "FR-MILK", qty: 12 }] },
      },
    });
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLANNED",
        capturedAt: clock,
        payload: { tripId: trip.id, vehicleId: vehicle.id, seq, etaFrom: clock, etaTo: clock, planVersion: 1 },
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        seq,
        etaMin: 330,
        windowOpen: 300,
        windowClose: 480,
        serviceMin: 15,
        orderId: created.id,
      },
    });
    return { id: created.id, lineId };
  };
  const a = await order("ORD10412", 1);
  const b = await order("ORD10413", 2);
  ids.orderA = a.id;
  ids.orderB = b.id;
  lines.aMilk = a.lineId;
  lines.bMilk = b.lineId;
}

describe.skipIf(!testDatabaseUrl)("dock shortfall resolution against PostgreSQL (ADR 0005, ADR 0026)", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<Who, { cookie: string; csrf: string; userId: string; deviceId: string; seq: number }>;

  const post = (who: Who, url: string, payload: object) =>
    app.inject({
      method: "POST",
      url,
      payload,
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: { [CSRF_HEADER]: sessions[who].csrf },
    });
  const resolve = (who: Who, orderId: string, lineId: string, outcome: string, note?: string) =>
    post(who, `/api/dispatch/orders/${orderId}/shorts/${lineId}/resolve`, { outcome, ...(note ? { note } : {}) });
  const loaderPush = (type: string, subject: Record<string, string>, payload: object) => {
    const s = sessions.loader;
    return post("loader", "/api/sync/events", {
      deviceId: s.deviceId,
      events: [
        {
          clientEventId: randomUUID(),
          deviceId: s.deviceId,
          deviceSeq: s.seq++,
          schemaVersion: 1,
          subject,
          source: "FIELD",
          actor: { userId: s.userId, role: "LOADER" },
          capturedAt: clock.toISOString(),
          type,
          payload,
        },
      ],
    });
  };
  const ready = async () =>
    (await loaderPush("TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip })).json().results[0];
  const events = (orderId: string) => prisma.orderEvent.count({ where: { orderId } });

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue51");
    prisma = suite.prisma;
    await seed(prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    const logins: Record<Who, Record<string, string>> = {
      loader: { role: "LOADER", loginId: "LDR002", pin: PIN },
      nimal: { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Kandy" },
      colombo: { role: "DISPATCHER", email: "colombo@waypoint.test", password: PASSWORD, depot: "Peliyagoda" },
      store: { role: "STORE", loginId: "OUT108", password: PASSWORD },
    };
    for (const [who, body] of Object.entries(logins) as [Who, Record<string, string>][]) {
      const deviceId = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: body.pin ? { ...body, deviceId } : body,
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
    // The loader flags 4 milk crates short on both orders and confirms the remaining 8.
    for (const [orderId, lineId] of [
      [ids.orderA, lines.aMilk],
      [ids.orderB, lines.bMilk],
    ] as const) {
      const short = await loaderPush(
        "LOAD_SHORT",
        { orderId },
        { lines: [{ lineId, qtyShort: 4 }], reasonCode: "STOCK_SHORT" },
      );
      expect(short.json().results[0].status).toBe("ACCEPTED");
      const load = await loaderPush("LOAD_CONFIRMED", { orderId }, { lines: [{ lineId, qtyLoaded: 8 }] });
      expect(load.json().results[0].status).toBe("ACCEPTED");
    }
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it("keeps the trip blocked while a line is unresolved or on HOLD_TRIP, and unblocks it after SHIP_PARTIAL", async () => {
    expect(await ready()).toMatchObject({ status: "REJECTED", code: "ILLEGAL_TRANSITION" });

    const hold = await resolve("nimal", ids.orderA, lines.aMilk, "HOLD_TRIP", "restock due at 04:00");
    expect(hold.statusCode, hold.body).toBe(200);
    expect(hold.json()).toMatchObject({
      backorder: null,
      serverTime: clock.toISOString(),
      order: { flags: { short: [{ lineId: lines.aMilk, qtyShort: 4, resolution: "HOLD_TRIP" }] } },
    });
    const afterHold = await events(ids.orderA);
    // Retrying HOLD_TRIP is a no-op.
    expect((await resolve("nimal", ids.orderA, lines.aMilk, "HOLD_TRIP")).statusCode).toBe(200);
    expect(await events(ids.orderA)).toBe(afterHold);

    expect((await resolve("nimal", ids.orderB, lines.bMilk, "SHIP_PARTIAL")).statusCode).toBe(200);
    // Order A is still held, so the trip still cannot be marked ready.
    expect(await ready()).toMatchObject({ status: "REJECTED", code: "ILLEGAL_TRANSITION" });

    const ship = await resolve("nimal", ids.orderA, lines.aMilk, "SHIP_PARTIAL");
    expect(ship.statusCode).toBe(200);
    expect(ship.json().order.flags.short[0].resolution).toBe("SHIP_PARTIAL");
    expect(await ready()).toMatchObject({ status: "ACCEPTED" });

    // SHIP_PARTIAL is final.
    const change = await resolve("nimal", ids.orderA, lines.aMilk, "BACKORDER");
    expect(change.statusCode).toBe(409);
    expect(change.json()).toMatchObject({ code: "ILLEGAL_TRANSITION", params: { resolution: "SHIP_PARTIAL" } });
  });

  it("notifies the store of each decision", async () => {
    const inbox = (
      await app.inject({
        method: "GET",
        url: "/api/store/notifications",
        cookies: { [SESSION_COOKIE]: sessions.store.cookie },
      })
    ).json();
    const resolved = inbox.items.filter((n: { kind: string }) => n.kind === "short_resolved");
    expect(resolved.length).toBeGreaterThanOrEqual(3);
    expect(resolved[0]).toMatchObject({ group: "DELIVERIES", params: { order: "ORD10412", outcome: "SHIP_PARTIAL" } });
  });

  it("creates one backorder for the short quantity, idempotently", async () => {
    // Orders A and B are final after the first test: use a third order with an open short line.
    const c = await prisma.order.create({
      data: {
        displayId: "ORD10414",
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date(DATE),
        currentDate: new Date(DATE),
        status: "PLANNED",
        weightG: 1,
        volumeL: 1,
        idempotencyKey: randomUUID(),
        outletId: ids.outlet,
        orderLine_orderId: {
          create: [{ productId: ids.milk, qtyOrdered: 6, unitWeightKg: "12.5", unitVolumeM3: "0.0205" }],
        },
      },
      include: { orderLine_orderId: true },
    });
    const cLine = c.orderLine_orderId[0]!.id;
    await prisma.orderEvent.create({
      data: {
        type: "ORDER_PLACED",
        source: "SERVER",
        actorRole: "DISPATCHER",
        actorUserId: ids.dispatcher,
        capturedAt: clock,
        orderId: c.id,
        payload: { requestedDate: DATE, lines: [{ lineId: cLine, skuId: "FR-MILK", qty: 6 }] },
      },
    });
    await prisma.orderEvent.create({
      data: {
        type: "LOAD_SHORT",
        source: "SERVER",
        actorRole: "DISPATCHER",
        actorUserId: ids.dispatcher,
        capturedAt: clock,
        orderId: c.id,
        payload: { lines: [{ lineId: cLine, qtyShort: 2 }], reasonCode: "STOCK_SHORT" },
      },
    });

    const res = await resolve("nimal", c.id, cLine, "BACKORDER");
    expect(res.statusCode, res.body).toBe(200);
    const { backorder } = res.json();
    expect(backorder).toMatchObject({
      replacesOrderId: c.id,
      status: "ORDERED",
      requestedDate: DATE,
      currentDate: DATE,
      tempRequirement: "chilled",
      // 2 crates x 12.5 kg and 20.5 L.
      weightG: 25000,
      volumeL: 41,
      lines: [{ productId: ids.milk, qtyOrdered: 2 }],
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: backorder.id } })).toMatchObject({
      idempotencyKey: `backorder:${c.id}:${cLine}`,
    });
    const placed = await prisma.orderEvent.findFirstOrThrow({ where: { orderId: backorder.id } });
    expect(placed).toMatchObject({ type: "ORDER_PLACED", actorRole: "DISPATCHER" });

    const before = await prisma.orderEvent.count();
    const retry = await resolve("nimal", c.id, cLine, "BACKORDER");
    expect(retry.json().backorder.id).toBe(backorder.id);
    expect(await prisma.orderEvent.count()).toBe(before);
    expect(await prisma.order.count({ where: { replacesOrderId: c.id } })).toBe(1);
    expect((await resolve("nimal", c.id, cLine, "SHIP_PARTIAL")).statusCode).toBe(409);
  });

  it("refuses unknown lines, orders without a short, other depots and other roles", async () => {
    expect((await resolve("nimal", ids.orderA, "no-such-line", "SHIP_PARTIAL")).statusCode).toBe(404);
    expect((await resolve("nimal", randomUUID(), lines.aMilk, "SHIP_PARTIAL")).statusCode).toBe(404);
    expect((await resolve("colombo", ids.orderA, lines.aMilk, "SHIP_PARTIAL")).statusCode).toBe(403);
    expect((await resolve("store", ids.orderA, lines.aMilk, "SHIP_PARTIAL")).statusCode).toBe(403);
    expect((await resolve("nimal", ids.orderA, lines.aMilk, "OTHER")).statusCode).toBe(400);
  });
});
