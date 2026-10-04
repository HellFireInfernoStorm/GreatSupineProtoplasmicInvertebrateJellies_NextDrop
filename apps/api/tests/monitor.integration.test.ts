// Delivery progress (issue #59, ADR 0041): run states on the server clock, the exceptions inbox, dispute resolution.
import { randomUUID } from "node:crypto";
import { colomboInstant, operatingDateAfter } from "@nextdrop/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl) console.info("Skipping monitor tests: set TEST_DATABASE_URL to a disposable _test database.");

const PIN = "2468";
const PASSWORD = "demo-password";
/** Tue 6 Oct 2026, Asia/Colombo. */
const DATE = "2026-10-06";
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(colomboInstant(DATE, h! * 60 + m!));
};
let current = at("06:00");
const ids = {} as Record<"kandy" | "veh039" | "milk" | "dispatcher" | "trip" | "A" | "B" | "C", string>;
const lines = {} as Record<"A" | "B" | "C", string>;
const photos = { pod: randomUUID(), damage: randomUUID(), problem: randomUUID(), store: randomUUID() };

type Who = "sampath" | "loader" | "nimal" | "colombo" | "store";
interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  deviceId: string;
  seq: number;
}

async function seed(prisma: PrismaClient) {
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
  const outlet = async (displayId: string) =>
    (
      await prisma.outlet.create({
        data: {
          displayId,
          brand: "Fresh",
          depot: "Kandy",
          dockType: "rear_dock",
          parkingConstraint: "normal",
          windowOpen: 300,
          windowClose: 720,
          districtId: ids.kandy,
        },
      })
    ).id;
  const outlets = [await outlet("OUT104"), await outlet("OUT105"), await outlet("OUT106")];
  ids.veh039 = (
    await prisma.vehicle.create({
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
    })
  ).id;
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
      { loginId: "OUT104", role: "STORE", displayName: "Ishara", passwordHash: password, outletId: outlets[0]! },
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

  // Today's published Kandy plan: one trip on VEH039, stops at 08:00, 08:30 and 09:00.
  const day = await prisma.planningDay.create({
    data: { depot: "Kandy", date: new Date(DATE), state: "PUBLISHED", currentVersion: 1 },
  });
  const trip = await prisma.trip.create({
    data: {
      displayId: "T001",
      tripNo: 1,
      brand: "Fresh",
      plannedDepart: 420,
      plannedMinutes: 240,
      km: 120,
      litres: 20,
      planningDayId: day.id,
      vehicleId: ids.veh039,
      districtId: ids.kandy,
    },
  });
  ids.trip = trip.id;
  for (const [i, key] of (["A", "B", "C"] as const).entries()) {
    const order = await prisma.order.create({
      data: {
        displayId: `ORD3000${i}`,
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date(DATE),
        currentDate: new Date(DATE),
        status: "PLANNED",
        weightG: 12000,
        volumeL: 20,
        idempotencyKey: randomUUID(),
        outletId: outlets[i]!,
        orderLine_orderId: {
          create: [{ productId: ids.milk, qtyOrdered: 10, unitWeightKg: 12, unitVolumeM3: "0.02" }],
        },
      },
      include: { orderLine_orderId: true },
    });
    ids[key] = order.id;
    lines[key] = order.orderLine_orderId[0]!.id;
    const server = {
      source: "SERVER" as const,
      actorRole: "DISPATCHER" as const,
      actorUserId: ids.dispatcher,
      orderId: order.id,
      capturedAt: current,
    };
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLACED",
        payload: { requestedDate: DATE, lines: [{ lineId: lines[key], skuId: "FR-MILK", qty: 10 }] },
      },
    });
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLANNED",
        payload: {
          tripId: trip.id,
          vehicleId: ids.veh039,
          seq: i,
          etaFrom: current.toISOString(),
          etaTo: current.toISOString(),
          planVersion: 1,
        },
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        seq: i + 1,
        etaMin: 480 + i * 30,
        windowOpen: 300,
        windowClose: 720,
        serviceMin: 15,
        orderId: order.id,
      },
    });
  }
}

describe.skipIf(!testDatabaseUrl)("run monitor, exceptions and disputes against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<Who, Session>;

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
  const call = (who: Who, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: method === "POST" ? { [CSRF_HEADER]: sessions[who].csrf } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  function ev(who: Who, type: string, subject: Record<string, string>, payload: unknown) {
    const s = sessions[who];
    return {
      clientEventId: randomUUID(),
      deviceId: s.deviceId,
      deviceSeq: s.seq++,
      schemaVersion: 1,
      subject,
      source: "FIELD",
      actor: { userId: s.userId, role: who === "loader" ? "LOADER" : "DRIVER" },
      capturedAt: current.toISOString(),
      basedOnPlanVersion: 1,
      type,
      payload,
    };
  }
  async function push(who: Who, events: unknown[]) {
    const res = await call(who, "POST", "/api/sync/events", { deviceId: sessions[who].deviceId, events });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().results as { status: string; code?: string }[];
  }
  const heartbeat = (pendingCount = 0) =>
    call("sampath", "POST", "/api/sync/heartbeat", {
      deviceId: sessions.sampath.deviceId,
      appVersion: "1.0.0",
      pendingCount,
      lastSyncAt: null,
      lastKnownStop: null,
    });
  async function run() {
    const res = await call("nimal", "GET", "/api/dispatch/runs?depot=Kandy");
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as {
      state: string;
      lateRisk: boolean;
      stopsDone: number;
      stopsTotal: number;
      lastHeardAt: string | null;
      pendingCount: number;
    }[];
    expect(items).toHaveLength(1);
    return items[0]!;
  }
  const outcome = (key: "A" | "B" | "C", result: "FULL" | "FAILED") =>
    ev(
      "sampath",
      "STOP_OUTCOME",
      { orderId: ids[key] },
      result === "FULL"
        ? { outcome: "FULL", lines: [{ lineId: lines[key], qtyDelivered: 10 }] }
        : { outcome: "FAILED", lines: [], reasonCode: "STORE_CLOSED" },
    );
  const pod = (key: "A" | "B" | "C") =>
    ev("sampath", "POD_CAPTURED", { orderId: ids[key] }, { receiverName: "Ishara", photoBlobRefs: [photos.pod] });

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue59");
    prisma = suite.prisma;
    await seed(prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => current });
    await app.ready();
    await signIn("sampath", { role: "DRIVER", loginId: "DRV039", pin: PIN });
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

  it("walks a run through ON_TRACK, NO_SIGNAL, BEHIND, ESCALATED and DONE on the server clock", async () => {
    // Before departure nothing is active, so silence is not "no signal".
    current = at("06:30");
    expect(await run()).toMatchObject({ state: "ON_TRACK", stopsDone: 0, stopsTotal: 3, lateRisk: false });

    // Dock flags, an acknowledgement and an illegal early delivery (the departure has not synced): see the inbox test.
    current = at("06:45");
    expect(
      (
        await push("loader", [
          ev(
            "loader",
            "LOAD_SHORT",
            { orderId: ids.B },
            { lines: [{ lineId: lines.B, qtyShort: 2 }], reasonCode: "STOCK_SHORT" },
          ),
          ev(
            "loader",
            "LOAD_DAMAGED",
            { orderId: ids.B },
            { lines: [{ lineId: lines.B, qty: 1 }], photoRef: photos.damage },
          ),
        ])
      ).map((r) => r.status),
    ).toEqual(["ACCEPTED", "ACCEPTED"]);
    expect(
      (
        await push("sampath", [
          ev("sampath", "PLAN_ACKNOWLEDGED", { tripId: ids.trip }, { planVersion: 1 }),
          outcome("C", "FULL"),
          pod("C"),
        ])
      ).map((r) => r.status),
    ).toEqual(["ACCEPTED", "HELD_CONFLICT", "ACCEPTED"]);

    current = at("07:10");
    const departed = ev("sampath", "TRIP_DEPARTED", { tripId: ids.trip }, { tripId: ids.trip });
    expect((await push("sampath", [departed]))[0]!.status).toBe("ACCEPTED");
    expect(await run()).toMatchObject({ state: "ON_TRACK", lastHeardAt: at("07:10").toISOString() });

    // 15 minutes without contact on a departed run.
    current = at("07:25");
    expect((await run()).state).toBe("NO_SIGNAL");

    // A heartbeat brings it back and hints the run, once.
    current = at("07:26");
    const head = await prisma.changeFeed.count({ where: { kind: "run_updated" } });
    expect((await heartbeat(2)).statusCode).toBe(200);
    expect(await prisma.changeFeed.count({ where: { kind: "run_updated" } })).toBe(head + 1);
    expect(await run()).toMatchObject({ state: "ON_TRACK", pendingCount: 2 });
    current = at("07:27");
    expect((await heartbeat(2)).statusCode).toBe(200);
    expect(await prisma.changeFeed.count({ where: { kind: "run_updated" } })).toBe(head + 1);

    // Past the first stop's 08:00 ETA: late risk at once, BEHIND after the 15-minute grace.
    current = at("08:05");
    await heartbeat();
    expect(await run()).toMatchObject({ state: "ON_TRACK", lateRisk: true });
    current = at("08:16");
    await heartbeat();
    expect(await run()).toMatchObject({ state: "BEHIND", lateRisk: true });
    // Behind and silent.
    current = at("08:30");
    expect((await run()).state).toBe("ESCALATED");

    // Every stop gets an outcome: delivered, failed, and the held stop delivered again on the road.
    current = at("08:40");
    const facts = [outcome("A", "FULL"), pod("A"), outcome("B", "FAILED"), outcome("C", "FULL")];
    expect((await push("sampath", facts)).map((r) => r.status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(await run()).toMatchObject({ state: "DONE", stopsDone: 3, stopsTotal: 3, lateRisk: false });
  });

  it("lists every exception from one inbox, with evidence", async () => {
    const issue = await call("store", "POST", `/api/store/orders/${ids.A}/issues`, {
      kind: "SHORT",
      lines: [{ lineId: lines.A, qty: 3 }],
      photo: photos.store,
      note: "Three crates missing",
    });
    expect(issue.statusCode, issue.body).toBe(201);

    const res = await call("nimal", "GET", "/api/dispatch/exceptions?depot=Kandy");
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as ({ type: string; evidence?: string[] } & Record<string, unknown>)[];
    const of = (type: string) => items.filter((i) => i.type === type);
    expect(of("CONFLICT")).toHaveLength(1);
    expect(of("CONFLICT")[0]).toMatchObject({
      conflict: { kind: "ILLEGAL_TRANSITION", orderId: ids.C },
      evidence: [photos.pod],
    });
    expect(of("ISSUE")).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ id: issue.json().issueId, orderId: ids.A, kind: "SHORT", resolvedAt: null }),
        evidence: [photos.store, photos.pod],
      }),
    ]);
    expect(of("SHORT")).toEqual([{ type: "SHORT", orderId: ids.B, lineId: lines.B, qtyShort: 2, resolution: null }]);
    expect(of("DAMAGED")).toEqual([
      { type: "DAMAGED", orderId: ids.B, lineId: lines.B, qty: 1, evidence: [photos.damage] },
    ]);
    expect(of("FAILED")).toEqual([
      expect.objectContaining({ order: expect.objectContaining({ id: ids.B, status: "FAILED" }) }),
    ]);
    expect(of("ACK")).toEqual([expect.objectContaining({ tripId: ids.trip, planVersion: 1 })]);

    // A problem flagged on the road shows with its photo.
    const flagged = ev(
      "sampath",
      "PROBLEM_FLAGGED",
      { vehicleId: ids.veh039 },
      { kind: "ROAD_BLOCKED", photoRef: photos.problem },
    );
    expect((await push("sampath", [flagged]))[0]!.status).toBe("ACCEPTED");
    const after = (await call("nimal", "GET", "/api/dispatch/exceptions?depot=Kandy")).json().items as typeof items;
    expect(after.filter((i) => i.type === "PROBLEM")).toEqual([
      expect.objectContaining({ kind: "ROAD_BLOCKED", evidence: [photos.problem], tripId: null, orderId: null }),
    ]);

    // Another depot's dispatcher cannot read Kandy's inbox or runs.
    expect((await call("colombo", "GET", "/api/dispatch/exceptions?depot=Kandy")).statusCode).toBe(403);
    expect((await call("colombo", "GET", "/api/dispatch/runs?depot=Kandy")).statusCode).toBe(403);
    expect((await call("store", "GET", "/api/dispatch/runs?depot=Kandy")).statusCode).toBe(403);
  });

  it("resolves a dispute with ADD_TO_RUN once, placing one follow-up order for the next run", async () => {
    const issueId = (await prisma.orderEvent.findFirstOrThrow({ where: { orderId: ids.A, type: "ISSUE_REPORTED" } }))
      .id;
    const resolve = (who: Who, resolution: string, id = issueId) =>
      call(who, "POST", `/api/dispatch/issues/${id}/resolve`, { resolution, note: "Sending the missing crates" });

    expect((await resolve("colombo", "ADD_TO_RUN")).statusCode).toBe(403);
    expect((await resolve("nimal", "ADD_TO_RUN", ids.trip)).statusCode).toBe(404);
    const res = await resolve("nimal", "ADD_TO_RUN");
    expect(res.statusCode, res.body).toBe(200);

    const a = await prisma.order.findUniqueOrThrow({
      where: { id: ids.A },
      include: { orderEvent_orderId: { orderBy: { id: "asc" } } },
    });
    expect(a.status).toBe("RECEIVED");
    expect(a.orderEvent_orderId.at(-1)).toMatchObject({
      type: "ISSUE_RESOLVED",
      payload: { resolution: "ADD_TO_RUN", note: "Sending the missing crates" },
    });
    const followUps = await prisma.order.findMany({
      where: { replacesOrderId: ids.A },
      include: { orderLine_orderId: true },
    });
    expect(followUps).toHaveLength(1);
    expect(followUps[0]!.orderLine_orderId.map((l) => l.qtyOrdered)).toEqual([3]);
    expect(followUps[0]!.currentDate.toISOString().slice(0, 10)).toBe(operatingDateAfter(DATE, new Map()));
    const notices = await prisma.notification.findMany({
      where: { kind: "dispute_updated", userId: sessions.store.userId },
    });
    expect(notices).toHaveLength(1);

    // The same decision again is a no-op; a different one is refused.
    expect((await resolve("nimal", "ADD_TO_RUN")).statusCode).toBe(200);
    expect(await prisma.order.count({ where: { replacesOrderId: ids.A } })).toBe(1);
    const change = await resolve("nimal", "CREDIT");
    expect(change.statusCode).toBe(409);
    expect(change.json()).toMatchObject({ code: "ILLEGAL_TRANSITION", params: { resolution: "ADD_TO_RUN" } });

    // The dispute has left the inbox.
    const items = (await call("nimal", "GET", "/api/dispatch/exceptions?depot=Kandy")).json().items as {
      type: string;
    }[];
    expect(items.filter((i) => i.type === "ISSUE")).toEqual([]);
  });

  it("GET /dispatch/outlook reports seeded weekly demand, a moving average after it, and depot capacity (#55)", async () => {
    await prisma.weeklyDemandHistory.createMany({
      data: [
        { depot: "Kandy", brand: "Fresh", isoYear: 2026, isoWeek: 39, totalVolumeM3: 50, chilledVolumeM3: 20 },
        { depot: "Kandy", brand: "Fresh", isoYear: 2026, isoWeek: 40, totalVolumeM3: 70, chilledVolumeM3: 30 },
        { depot: "Peliyagoda", brand: "Fresh", isoYear: 2026, isoWeek: 40, totalVolumeM3: 999, chilledVolumeM3: 1 },
      ],
    });
    const vehicles = await prisma.vehicle.findMany({ where: { depot: "Kandy" } });
    const capacity = Math.round(vehicles.reduce((sum, v) => sum + Number(v.volumeCapM3), 0) * 6 * 1000);
    const res = await call("nimal", "GET", "/api/dispatch/outlook?depot=Kandy&from=2026-09-21&weeks=3");
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      {
        isoYear: 2026,
        isoWeek: 39,
        brand: "Fresh",
        demandVolumeL: 50000,
        chilledVolumeL: 20000,
        capacityVolumeL: capacity,
      },
      {
        isoYear: 2026,
        isoWeek: 40,
        brand: "Fresh",
        demandVolumeL: 70000,
        chilledVolumeL: 30000,
        capacityVolumeL: capacity,
      },
      {
        isoYear: 2026,
        isoWeek: 41,
        brand: "Fresh",
        demandVolumeL: 60000,
        chilledVolumeL: 25000,
        capacityVolumeL: capacity,
      },
    ]);
    expect((await call("colombo", "GET", "/api/dispatch/outlook?depot=Kandy&from=2026-09-21&weeks=3")).statusCode).toBe(
      403,
    );
  });
});
