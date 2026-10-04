import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping checklist readiness tests: set TEST_DATABASE_URL to a disposable _test database.");

const PIN = "2468";
const DATE = "2026-10-04";
const clock = new Date("2026-10-04T00:00:00.000Z");

describe.skipIf(!testDatabaseUrl)("TRIP_READY checklist readiness against PostgreSQL (ADR 0046)", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  let cookie = "";
  let csrf = "";
  let userId = "";
  let deviceId = "";
  let seq = 0;
  const ids = {} as Record<"trip" | "order" | "lineMilk" | "lineEggs" | "dispatcher", string>;

  function ev(type: string, subject: Record<string, string>, payload: unknown) {
    return {
      clientEventId: randomUUID(),
      deviceId,
      deviceSeq: seq++,
      schemaVersion: 1,
      subject,
      source: "FIELD",
      actor: { userId, role: "LOADER" },
      capturedAt: "2026-10-03T23:50:00.000Z",
      type,
      payload,
    };
  }
  const push = (events: unknown[]) =>
    app.inject({
      method: "POST",
      url: "/api/sync/events",
      payload: { deviceId, events },
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { [CSRF_HEADER]: csrf },
    });

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue115");
    prisma = suite.prisma;
    const pin = await hashSecret(PIN);
    const password = await hashSecret("demo-password");
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
    const outlet = await prisma.outlet.create({
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
    });
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
      },
    });
    const milk = await prisma.product.create({
      data: {
        sku: "FR-MILK",
        name: "Milk",
        brand: "Fresh",
        tempRequirement: "chilled",
        unitLabel: "crate",
        unitWeightKg: 12,
        unitVolumeM3: "0.02",
      },
    });
    const eggs = await prisma.product.create({
      data: {
        sku: "FR-EGGS",
        name: "Eggs",
        brand: "Fresh",
        tempRequirement: "chilled",
        unitLabel: "crate",
        unitWeightKg: 12,
        unitVolumeM3: "0.02",
      },
    });
    const users = await prisma.user.createManyAndReturn({
      data: [
        { loginId: "LDR002", role: "LOADER", displayName: "Pradeep", passwordHash: pin, depot: "Kandy" },
        { loginId: "nimal@waypoint.test", role: "DISPATCHER", displayName: "Nimal", passwordHash: password },
      ],
      select: { id: true, loginId: true },
    });
    ids.dispatcher = users.find((u) => u.loginId === "nimal@waypoint.test")!.id;
    const day = await prisma.planningDay.create({
      data: { depot: "Kandy", date: new Date(DATE), state: "PUBLISHED", currentVersion: 1 },
    });
    const trip = await prisma.trip.create({
      data: {
        displayId: "T115",
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
    const order = await prisma.order.create({
      data: {
        displayId: "ORD11501",
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date(DATE),
        currentDate: new Date(DATE),
        status: "PLANNED",
        weightG: 1000,
        volumeL: 10,
        idempotencyKey: randomUUID(),
        outletId: outlet.id,
        orderLine_orderId: {
          create: [
            { productId: milk.id, qtyOrdered: 10, unitWeightKg: 12, unitVolumeM3: "0.02" },
            { productId: eggs.id, qtyOrdered: 6, unitWeightKg: 12, unitVolumeM3: "0.02" },
          ],
        },
      },
      include: { orderLine_orderId: { orderBy: { id: "asc" } } },
    });
    ids.order = order.id;
    ids.lineMilk = order.orderLine_orderId.find((l) => l.productId === milk.id)!.id;
    ids.lineEggs = order.orderLine_orderId.find((l) => l.productId === eggs.id)!.id;
    const server = {
      source: "SERVER" as const,
      actorRole: "DISPATCHER" as const,
      actorUserId: ids.dispatcher,
      orderId: order.id,
    };
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLACED",
        capturedAt: clock,
        payload: {
          requestedDate: DATE,
          lines: order.orderLine_orderId.map((l) => ({ lineId: l.id, qty: l.qtyOrdered })),
        },
      },
    });
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLANNED",
        capturedAt: clock,
        payload: { tripId: trip.id, vehicleId: vehicle.id, seq: 1, etaFrom: clock, etaTo: clock, planVersion: 1 },
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        seq: 1,
        etaMin: 330,
        windowOpen: 300,
        windowClose: 480,
        serviceMin: 15,
        orderId: order.id,
      },
    });

    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    deviceId = randomUUID();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "LOADER", loginId: "LDR002", pin: PIN, deviceId },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(login.statusCode, login.body).toBe(200);
    cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    csrf = login.json().csrfToken;
    userId = login.json().user.id;
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it("refuses an entirely unchecked trip", async () => {
    const res = (await push([ev("TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip })])).json();
    expect(res.results[0]).toMatchObject({ status: "REJECTED", code: "ILLEGAL_TRANSITION" });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip } })).status).toBe("PLANNED");
  });

  it("refuses a partially checked multi-line order and accepts after mixed short/damaged completion", async () => {
    const onlyMilk = await push([
      ev("LOAD_CONFIRMED", { orderId: ids.order }, { lines: [{ lineId: ids.lineMilk, qtyLoaded: 10 }] }),
      ev("TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip }),
    ]);
    expect(onlyMilk.json().results.map((r: { status: string }) => r.status)).toEqual(["ACCEPTED", "REJECTED"]);
    expect(onlyMilk.json().results[1]).toMatchObject({ code: "ILLEGAL_TRANSITION" });

    const mixed = await push([
      ev(
        "LOAD_SHORT",
        { orderId: ids.order },
        { lines: [{ lineId: ids.lineEggs, qtyShort: 2 }], reasonCode: "STOCK_SHORT" },
      ),
      ev(
        "LOAD_DAMAGED",
        { orderId: ids.order },
        {
          lines: [{ lineId: ids.lineEggs, qty: 1 }],
          reasonCode: "CRUSHED",
        },
      ),
      ev("LOAD_CONFIRMED", { orderId: ids.order }, { lines: [{ lineId: ids.lineEggs, qtyLoaded: 3 }] }),
      ev("TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip }),
    ]);
    // Short still unresolved: checklist complete (3+2+1=6) but dispatcher blocks.
    expect(mixed.json().results.map((r: { status: string }) => r.status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
      "REJECTED",
    ]);

    await prisma.orderEvent.create({
      data: {
        type: "SHORT_RESOLVED",
        source: "SERVER",
        actorRole: "DISPATCHER",
        actorUserId: ids.dispatcher,
        capturedAt: clock,
        orderId: ids.order,
        payload: { orderId: ids.order, lineId: ids.lineEggs, outcome: "SHIP_PARTIAL" },
      },
    });
    const ready = (await push([ev("TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip })])).json();
    expect(ready.results[0].status).toBe("ACCEPTED");
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip } })).status).toBe("READY");
  });

  it("accepts offline replay of the same TRIP_READY without moving the trip again", async () => {
    const again = (await push([ev("TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip })])).json();
    expect(again.results[0].status).toBe("ACCEPTED");
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip } })).status).toBe("READY");
  });

  it("refuses TRIP_READY after LOAD_REVERSED clears qtyLoaded (ADR 0046)", async () => {
    // Fresh trip/order: the shared suite trip is already READY and must not delete events.
    const baseTrip = await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip } });
    const baseOrder = await prisma.order.findUniqueOrThrow({ where: { id: ids.order } });
    const milkProductId = (await prisma.orderLine.findUniqueOrThrow({ where: { id: ids.lineMilk } })).productId;

    const trip = await prisma.trip.create({
      data: {
        displayId: "T115R",
        tripNo: 2,
        brand: "Fresh",
        plannedDepart: 300,
        plannedMinutes: 200,
        km: 80,
        litres: 15,
        planningDayId: baseTrip.planningDayId,
        vehicleId: baseTrip.vehicleId,
        districtId: baseTrip.districtId,
      },
    });
    const order = await prisma.order.create({
      data: {
        displayId: "ORD115R",
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date(DATE),
        currentDate: new Date(DATE),
        status: "PLANNED",
        weightG: 500,
        volumeL: 5,
        idempotencyKey: randomUUID(),
        outletId: baseOrder.outletId,
        orderLine_orderId: {
          create: [{ productId: milkProductId, qtyOrdered: 12, unitWeightKg: 12, unitVolumeM3: "0.02" }],
        },
      },
      include: { orderLine_orderId: true },
    });
    const lineId = order.orderLine_orderId[0]!.id;
    const server = {
      source: "SERVER" as const,
      actorRole: "DISPATCHER" as const,
      actorUserId: ids.dispatcher,
      orderId: order.id,
    };
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLACED",
        capturedAt: clock,
        payload: { requestedDate: DATE, lines: [{ lineId, qty: 12 }] },
      },
    });
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLANNED",
        capturedAt: clock,
        payload: {
          tripId: trip.id,
          vehicleId: baseTrip.vehicleId,
          seq: 1,
          etaFrom: clock,
          etaTo: clock,
          planVersion: 1,
        },
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        seq: 1,
        etaMin: 360,
        windowOpen: 300,
        windowClose: 480,
        serviceMin: 15,
        orderId: order.id,
      },
    });

    expect(
      (await push([ev("LOAD_CONFIRMED", { orderId: order.id }, { lines: [{ lineId, qtyLoaded: 12 }] })])).json()
        .results[0].status,
    ).toBe("ACCEPTED");
    expect((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } })).qtyLoaded).toBe(12);

    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "LOAD_REVERSAL_REQUESTED",
        capturedAt: clock,
        payload: { orderId: order.id, to: "PLANNED", planVersion: 1 },
      },
    });
    expect(
      (await push([ev("LOAD_REVERSED", { orderId: order.id }, { orderId: order.id, lines: [] })])).json().results[0]
        .status,
    ).toBe("ACCEPTED");
    expect((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } })).qtyLoaded).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }).then((o) => o.status)).toBe("PLANNED");

    const blocked = (await push([ev("TRIP_READY", { tripId: trip.id }, { tripId: trip.id })])).json();
    expect(blocked.results[0]).toMatchObject({ status: "REJECTED", code: "ILLEGAL_TRANSITION" });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe("PLANNED");
  });
});
