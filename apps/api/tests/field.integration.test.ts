import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping field integration tests: set TEST_DATABASE_URL to a disposable _test database.");

const PIN = "2468";
const PASSWORD = "demo-password";
const DATE = "2026-10-04";
/** Sun 4 Oct 2026, 05:30 Asia/Colombo. */
const clock = new Date("2026-10-04T00:00:00.000Z");
const ids = {} as Record<
  "kandy" | "out108" | "out105" | "veh039" | "veh001" | "milk" | "eggs" | "dispatcher" | "trip" | "orderA" | "orderB",
  string
>;
const lines = {} as Record<"aMilk" | "aEggs" | "bMilk", string>;

type Who = "loader" | "sampath" | "ruwan" | "store" | "nimal";
interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  deviceId: string;
  seq: number;
}

async function seed(prisma: PrismaClient) {
  const kandy = await prisma.district.create({
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
  ids.kandy = kandy.id;
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
          windowClose: 480,
          districtId: kandy.id,
        },
      })
    ).id;
  ids.out108 = await outlet("OUT108");
  ids.out105 = await outlet("OUT105");
  const vehicle = async (displayId: string, depot: string, driver: string) =>
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
          depot,
          driver_vehicleId: {
            create: { displayId: `DRV${displayId.slice(3)}`, name: driver, phone: "+94 77 000 0000" },
          },
        },
      })
    ).id;
  ids.veh039 = await vehicle("VEH039", "Kandy", "Sampath");
  ids.veh001 = await vehicle("VEH001", "Peliyagoda", "Ruwan S.");
  const product = async (sku: string) =>
    (
      await prisma.product.create({
        data: {
          sku,
          name: sku,
          brand: "Fresh",
          tempRequirement: "chilled",
          unitLabel: "crate",
          unitWeightKg: 12,
          unitVolumeM3: "0.02",
        },
      })
    ).id;
  ids.milk = await product("FR-MILK");
  ids.eggs = await product("FR-EGGS");
  const pin = await hashSecret(PIN);
  const password = await hashSecret(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      { loginId: "LDR002", role: "LOADER", displayName: "Pradeep", passwordHash: pin, depot: "Kandy" },
      { loginId: "DRV039", role: "DRIVER", displayName: "Sampath", passwordHash: pin, vehicleId: ids.veh039 },
      { loginId: "DRV001", role: "DRIVER", displayName: "Ruwan S.", passwordHash: pin, vehicleId: ids.veh001 },
      { loginId: "OUT108", role: "STORE", displayName: "Ishara", passwordHash: password, outletId: ids.out108 },
      { loginId: "nimal@waypoint.test", role: "DISPATCHER", displayName: "Nimal", passwordHash: password },
    ],
    select: { id: true, loginId: true },
  });
  ids.dispatcher = users.find((u) => u.loginId === "nimal@waypoint.test")!.id;

  // A published Kandy plan: one trip on VEH039 with two planned orders.
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
      vehicleId: ids.veh039,
      districtId: kandy.id,
    },
  });
  ids.trip = trip.id;
  const order = async (displayId: string, outletId: string, seq: number, items: [string, number][]) => {
    const created = await prisma.order.create({
      data: {
        displayId,
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date(DATE),
        currentDate: new Date(DATE),
        status: "PLANNED",
        weightG: 1000,
        volumeL: 10,
        idempotencyKey: randomUUID(),
        outletId,
        orderLine_orderId: {
          create: items.map(([productId, qty]) => ({
            productId,
            qtyOrdered: qty,
            unitWeightKg: 12,
            unitVolumeM3: "0.02",
          })),
        },
      },
      include: { orderLine_orderId: { orderBy: { id: "asc" } } },
    });
    const server = {
      source: "SERVER" as const,
      actorRole: "DISPATCHER" as const,
      actorUserId: ids.dispatcher,
      orderId: created.id,
    };
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLACED",
        capturedAt: clock,
        payload: {
          requestedDate: DATE,
          lines: created.orderLine_orderId.map((l) => ({ lineId: l.id, skuId: "FR-SKU", qty: l.qtyOrdered })),
        },
      },
    });
    await prisma.orderEvent.create({
      data: {
        ...server,
        type: "ORDER_PLANNED",
        capturedAt: clock,
        payload: { tripId: trip.id, vehicleId: ids.veh039, seq, etaFrom: clock, etaTo: clock, planVersion: 1 },
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        seq,
        etaMin: 330 + seq * 20,
        windowOpen: 300,
        windowClose: 480,
        serviceMin: 15,
        orderId: created.id,
      },
    });
    return created;
  };
  const a = await order("ORD10412", ids.out108, 1, [
    [ids.milk, 12],
    [ids.eggs, 8],
  ]);
  const b = await order("ORD10490", ids.out105, 2, [[ids.milk, 10]]);
  ids.orderA = a.id;
  ids.orderB = b.id;
  lines.aMilk = a.orderLine_orderId.find((l) => l.productId === ids.milk)!.id;
  lines.aEggs = a.orderLine_orderId.find((l) => l.productId === ids.eggs)!.id;
  lines.bMilk = b.orderLine_orderId[0]!.id;
}

describe.skipIf(!testDatabaseUrl)("field snapshot, sync push and heartbeat against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<Who, Session>;

  async function signIn(who: Who, payload: Record<string, string>) {
    const deviceId = randomUUID();
    const body = payload.pin ? { ...payload, deviceId } : payload;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: body,
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
  const get = (who: Who, url: string) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: sessions[who].cookie } });
  const post = (who: Who, url: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url,
      payload: payload as object,
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: { [CSRF_HEADER]: sessions[who].csrf, ...headers },
    });
  /** A client event from `who`'s device, with the next deviceSeq. */
  function ev(who: Who, type: string, subject: Record<string, string>, payload: unknown, extra: object = {}) {
    const s = sessions[who];
    return {
      clientEventId: randomUUID(),
      deviceId: s.deviceId,
      deviceSeq: s.seq++,
      schemaVersion: 1,
      subject,
      source: "FIELD",
      actor: { userId: s.userId, role: who === "loader" ? "LOADER" : "DRIVER" },
      capturedAt: "2026-10-03T23:50:00.000Z",
      clockOffsetMs: 1200,
      type,
      payload,
      ...extra,
    };
  }
  const push = (who: Who, events: unknown[]) =>
    post(who, "/api/sync/events", { deviceId: sessions[who].deviceId, events });
  const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue47");
    prisma = suite.prisma;
    await seed(prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    await signIn("loader", { role: "LOADER", loginId: "LDR002", pin: PIN });
    await signIn("sampath", { role: "DRIVER", loginId: "DRV039", pin: PIN });
    await signIn("ruwan", { role: "DRIVER", loginId: "DRV001", pin: PIN });
    await signIn("store", { role: "STORE", loginId: "OUT108", password: PASSWORD });
    await signIn("nimal", { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Kandy" });
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  describe("GET /field/snapshot", () => {
    it("gives the driver the vehicle's run with every stop, plan version, cursor and config", async () => {
      const res = await get("sampath", `/api/field/snapshot?date=${DATE}`);
      expect(res.statusCode, res.body).toBe(200);
      const snap = res.json();
      expect(snap).toMatchObject({
        role: "DRIVER",
        planVersion: 1,
        serverTime: clock.toISOString(),
        feedCursor: expect.stringMatching(/^\d+$/),
        resetEpoch: 0,
        config: { noSignalAfterMin: 10, lateGraceMin: 15, rules: { cutoffMinute: 960 } },
        scope: {
          date: DATE,
          vehicle: { displayId: "VEH039", driver: { name: "Sampath" }, weightCapG: 3000000, volumeCapL: 20000 },
        },
      });
      expect(snap.scope.trips).toHaveLength(1);
      expect(snap.scope.trips[0].stops.map((s: { order: { displayId: string } }) => s.order.displayId)).toEqual([
        "ORD10412",
        "ORD10490",
      ]);
      expect(snap.config.reasons.loadShort[0]).toEqual({ code: "STOCK_SHORT", message_key: "loadShort.STOCK_SHORT" });
      expect(snap.config.reasons.loadDamaged[0]).toEqual({ code: "CRUSHED", message_key: "loadDamaged.CRUSHED" });
      expect(snap.config.reasons.loadDamaged.map((r: { code: string }) => r.code)).toEqual([
        "CRUSHED",
        "LEAKING",
        "TORN_PACKAGING",
        "CONTAMINATED",
        "OTHER",
      ]);
    });

    it("gives the loader the depot's trips and another depot's driver nothing", async () => {
      const loader = (await get("loader", `/api/field/snapshot?date=${DATE}`)).json();
      expect(loader).toMatchObject({ role: "LOADER", scope: { depot: "Kandy", date: DATE, reversals: [] } });
      expect(loader.scope.trips).toHaveLength(1);
      const ruwan = (await get("ruwan", `/api/field/snapshot?date=${DATE}`)).json();
      expect(ruwan.scope.trips).toEqual([]);
      expect(ruwan.planVersion).toBeNull();
      expect((await get("store", `/api/field/snapshot?date=${DATE}`)).statusCode).toBe(403);
    });
  });

  describe("POST /sync/events", () => {
    let loadBatch: ReturnType<typeof ev>[];
    let firstResults: { status: string; serverEventId?: string }[];

    it("ingests a batch in deviceSeq order with per-event results and notifications", async () => {
      const short = ev(
        "loader",
        "LOAD_SHORT",
        { orderId: ids.orderA },
        {
          lines: [{ lineId: lines.aMilk, qtyShort: 4 }],
          reasonCode: "STOCK_SHORT",
        },
      );
      const loadA = ev(
        "loader",
        "LOAD_CONFIRMED",
        { orderId: ids.orderA },
        {
          lines: [
            { lineId: lines.aMilk, qtyLoaded: 8 },
            { lineId: lines.aEggs, qtyLoaded: 8 },
          ],
        },
      );
      const loadB = ev(
        "loader",
        "LOAD_CONFIRMED",
        { orderId: ids.orderB },
        { lines: [{ lineId: lines.bMilk, qtyLoaded: 10 }] },
      );
      // Submitted out of order: results keep the input positions.
      loadBatch = [loadB, short, loadA];
      const res = await push("loader", loadBatch);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      firstResults = body.results;
      expect(body.results.map((r: { status: string }) => r.status)).toEqual(["ACCEPTED", "ACCEPTED", "ACCEPTED"]);
      expect(body.results.map((r: { clientEventId: string }) => r.clientEventId)).toEqual(
        loadBatch.map((e) => e.clientEventId),
      );
      expect(body).toMatchObject({ serverTime: clock.toISOString(), feedHead: expect.stringMatching(/^\d+$/) });

      expect(await orderStatus(ids.orderA)).toBe("LOADED");
      const stored = await prisma.orderEvent.findMany({
        where: { orderId: ids.orderA, source: "FIELD" },
        orderBy: { id: "asc" },
      });
      expect(stored.map((e) => [e.type, e.deviceSeq])).toEqual([
        ["LOAD_SHORT", 0],
        ["LOAD_CONFIRMED", 1],
      ]);
      expect(stored[0]).toMatchObject({
        clockOffsetMs: 1200n,
        capturedAt: new Date("2026-10-03T23:50:00.000Z"),
        receivedAt: clock,
      });
      const milk = await prisma.orderLine.findUniqueOrThrow({ where: { id: lines.aMilk } });
      expect(milk.qtyLoaded).toBe(8);
      const storeInbox = (await get("store", "/api/notifications")).json();
      expect(storeInbox.items[0]).toMatchObject({ kind: "short_reported", params: { order: "ORD10412" } });
      expect((await get("nimal", "/api/notifications")).json().items[0].kind).toBe("short_reported");
      const detail = (await get("store", `/api/store/orders/${ids.orderA}`)).json();
      expect(detail.order.flags.short).toEqual([{ lineId: lines.aMilk, qtyShort: 4, resolution: null }]);
    });

    it("is idempotent when the same batch is replayed", async () => {
      const before = await prisma.orderEvent.count();
      const replay = (await push("loader", loadBatch)).json();
      expect(replay.results.map((r: { status: string }) => r.status)).toEqual(["DUPLICATE", "DUPLICATE", "DUPLICATE"]);
      expect(replay.results.map((r: { serverEventId: string }) => r.serverEventId)).toEqual(
        firstResults.map((r) => r.serverEventId),
      );
      expect(await prisma.orderEvent.count()).toBe(before);
    });

    it("preserves LOAD_DAMAGED reasonCode and photoRef through ingest, flags and timeline", async () => {
      const photoRef = randomUUID();
      const damaged = ev(
        "loader",
        "LOAD_DAMAGED",
        { orderId: ids.orderA },
        {
          lines: [{ lineId: lines.aEggs, qty: 1 }],
          reasonCode: "LEAKING",
          photoRef,
        },
      );
      const invalid = ev(
        "loader",
        "LOAD_DAMAGED",
        { orderId: ids.orderA },
        {
          lines: [{ lineId: lines.aEggs, qty: 1 }],
          reasonCode: "STOCK_SHORT",
        },
      );
      const legacy = {
        ...ev("loader", "LOAD_DAMAGED", { orderId: ids.orderB }, { lines: [{ lineId: lines.bMilk, qty: 2 }] }),
        schemaVersion: 1,
      };
      const res = (await push("loader", [damaged, invalid, legacy])).json();
      expect(res.results.map((r: { status: string }) => r.status)).toEqual(["ACCEPTED", "REJECTED", "ACCEPTED"]);
      expect(res.results[1]).toMatchObject({ status: "REJECTED", code: "SCHEMA_INVALID", index: 1 });

      const stored = await prisma.orderEvent.findFirstOrThrow({
        where: { orderId: ids.orderA, type: "LOAD_DAMAGED", clientEventId: damaged.clientEventId },
      });
      expect(stored.schemaVersion).toBe(2);
      expect(stored.payload).toEqual({
        lines: [{ lineId: lines.aEggs, qty: 1 }],
        reasonCode: "LEAKING",
        photoRef,
      });

      const legacyStored = await prisma.orderEvent.findFirstOrThrow({
        where: { orderId: ids.orderB, type: "LOAD_DAMAGED", clientEventId: legacy.clientEventId },
      });
      expect(legacyStored.schemaVersion).toBe(2);
      expect(legacyStored.payload).toEqual({
        lines: [{ lineId: lines.bMilk, qty: 2 }],
        reasonCode: "OTHER",
      });

      const detail = (await get("store", `/api/store/orders/${ids.orderA}`)).json();
      expect(detail.order.flags.damaged).toEqual([{ lineId: lines.aEggs, qty: 1 }]);
      const timelineEvent = detail.timeline.find((e: { type: string }) => e.type === "LOAD_DAMAGED");
      expect(timelineEvent).toMatchObject({
        type: "LOAD_DAMAGED",
        schemaVersion: 2,
        payload: { lines: [{ lineId: lines.aEggs, qty: 1 }], reasonCode: "LEAKING", photoRef },
      });
      expect((await get("nimal", "/api/notifications")).json().items[0].kind).toBe("damaged_reported");
    });

    it("refuses TRIP_READY until every short line is resolved other than HOLD_TRIP (ADR 0005)", async () => {
      const blocked = (
        await push("loader", [ev("loader", "TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip })])
      ).json();
      expect(blocked.results[0]).toMatchObject({ status: "REJECTED", code: "ILLEGAL_TRANSITION", index: 0 });
      await prisma.orderEvent.create({
        data: {
          type: "SHORT_RESOLVED",
          source: "SERVER",
          actorRole: "DISPATCHER",
          actorUserId: ids.dispatcher,
          capturedAt: clock,
          orderId: ids.orderA,
          payload: { orderId: ids.orderA, lineId: lines.aMilk, outcome: "SHIP_PARTIAL" },
        },
      });
      const ready = (
        await push("loader", [ev("loader", "TRIP_READY", { tripId: ids.trip }, { tripId: ids.trip })])
      ).json();
      expect(ready.results[0].status).toBe("ACCEPTED");
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip } })).status).toBe("READY");
      const stops = await prisma.tripStop.findMany({ where: { tripId: ids.trip } });
      expect(stops.every((s) => s.tripStatus === "READY")).toBe(true);
    });

    it("handles a partial batch: bad events are rejected with their index, good neighbours are accepted", async () => {
      const malformed = { ...ev("loader", "LOAD_DAMAGED", { orderId: ids.orderA }, { lines: [] }) };
      const wrongAuthor = ev("loader", "STOP_ARRIVED", { orderId: ids.orderA }, { orderId: ids.orderA });
      const ack = ev("loader", "PLAN_ACKNOWLEDGED", { tripId: ids.trip }, { planVersion: 1 });
      const otherDevice = {
        ...ev("loader", "PLAN_ACKNOWLEDGED", { tripId: ids.trip }, { planVersion: 1 }),
        deviceId: randomUUID(),
      };
      const res = (await push("loader", [malformed, wrongAuthor, ack, otherDevice, { junk: true }])).json();
      expect(res.results).toEqual([
        expect.objectContaining({
          status: "REJECTED",
          code: "SCHEMA_INVALID",
          index: 0,
          clientEventId: malformed.clientEventId,
        }),
        expect.objectContaining({ status: "REJECTED", code: "FORBIDDEN", index: 1 }),
        expect.objectContaining({ status: "ACCEPTED", clientEventId: ack.clientEventId }),
        expect.objectContaining({ status: "REJECTED", code: "FORBIDDEN", index: 3 }),
        expect.objectContaining({ status: "REJECTED", code: "SCHEMA_INVALID", index: 4, clientEventId: null }),
      ]);
    });

    it("derives out-for-delivery on departure and confirms a delivery after sync", async () => {
      const depart = ev("sampath", "TRIP_DEPARTED", { tripId: ids.trip }, { tripId: ids.trip });
      const deliver = ev("sampath", "STOP_OUTCOME", { orderId: ids.orderA }, { outcome: "FULL", lines: [] });
      const res = (await push("sampath", [depart, deliver])).json();
      expect(res.results.map((r: { status: string }) => r.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip } })).status).toBe("DEPARTED");
      expect(await orderStatus(ids.orderB)).toBe("OUT_FOR_DELIVERY");
      const derived = await prisma.orderEvent.findMany({
        where: { orderId: ids.orderB, type: "ORDER_OUT_FOR_DELIVERY" },
      });
      expect(derived).toEqual([expect.objectContaining({ source: "SERVER", payload: { tripId: ids.trip } })]);
      const a = await prisma.order.findUniqueOrThrow({
        where: { id: ids.orderA },
        include: { orderLine_orderId: true },
      });
      expect(a.status).toBe("DELIVERED");
      expect(a.confirmedAt).toEqual(clock);
      expect(a.orderLine_orderId.find((l) => l.id === lines.aMilk)!.qtyDelivered).toBe(8);
      expect((await get("store", "/api/notifications")).json().items[0].kind).toBe("delivered");
    });

    it("records a late earlier-stage fact without regressing status", async () => {
      // The loader's offline confirmation of order B arrives after the departure.
      const late = ev(
        "loader",
        "LOAD_CONFIRMED",
        { orderId: ids.orderB },
        { lines: [{ lineId: lines.bMilk, qtyLoaded: 10 }] },
      );
      const res = (await push("loader", [late])).json();
      expect(res.results[0].status).toBe("ACCEPTED");
      expect(await orderStatus(ids.orderB)).toBe("OUT_FOR_DELIVERY");
    });

    it("rejects events that depend on a rejected one", async () => {
      const deliverB = ev("sampath", "STOP_OUTCOME", { orderId: ids.orderB }, { outcome: "FULL", lines: [] });
      expect((await push("sampath", [deliverB])).json().results[0].status).toBe("ACCEPTED");
      // FAILED after DELIVERED is illegal; the proof captured right after it depends on it.
      const failed = ev("sampath", "STOP_OUTCOME", { orderId: ids.orderB }, { outcome: "FAILED", lines: [] });
      const pod = ev("sampath", "POD_CAPTURED", { orderId: ids.orderB }, { receiverName: "Ishara", photoBlobRefs: [] });
      const res = (await push("sampath", [failed, pod])).json();
      expect(res.results).toEqual([
        expect.objectContaining({ status: "REJECTED", code: "ILLEGAL_TRANSITION", index: 0 }),
        expect.objectContaining({ status: "REJECTED", code: "ILLEGAL_TRANSITION", index: 1 }),
      ]);
    });

    it("enforces scope, identity and device sequence", async () => {
      const foreign = ev("ruwan", "STOP_ARRIVED", { orderId: ids.orderA }, { orderId: ids.orderA });
      const spoofed = {
        ...ev("ruwan", "PROBLEM_FLAGGED", { vehicleId: ids.veh001 }, { kind: "RUNNING_LATE", note: "" }),
      };
      spoofed.actor = { userId: sessions.sampath.userId, role: "DRIVER" };
      const res = (await push("ruwan", [foreign, spoofed])).json();
      expect(res.results.map((r: { code: string }) => r.code)).toEqual(["NOT_ASSIGNED", "FORBIDDEN"]);

      const reused = ev("ruwan", "PROBLEM_FLAGGED", { vehicleId: ids.veh001 }, { kind: "RUNNING_LATE", note: "" });
      expect((await push("ruwan", [reused])).json().results[0].status).toBe("ACCEPTED");
      const sameSeq = { ...reused, clientEventId: randomUUID() };
      expect((await push("ruwan", [sameSeq])).json().results[0]).toMatchObject({
        status: "REJECTED",
        code: "DUPLICATE",
      });

      const wrongBatch = await post("ruwan", "/api/sync/events", { deviceId: randomUUID(), events: [] });
      expect(wrongBatch.statusCode).toBe(403);
      expect((await post("store", "/api/sync/events", { deviceId: randomUUID(), events: [] })).statusCode).toBe(403);
    });

    it("refuses a batch over 1 MB with 413 PAYLOAD_TOO_LARGE", async () => {
      const big = ev(
        "ruwan",
        "PROBLEM_FLAGGED",
        { vehicleId: ids.veh001 },
        { kind: "RUNNING_LATE", note: "x".repeat(1_000_001) },
      );
      const res = await push("ruwan", [big]);
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  describe("POST /sync/heartbeat", () => {
    it("records last heard, pending count and last known stop for the session's device", async () => {
      const stop = randomUUID();
      const body = {
        deviceId: sessions.sampath.deviceId,
        appVersion: "1.4.0",
        pendingCount: 2,
        lastSyncAt: "2026-10-03T23:58:00.000Z",
        lastKnownStop: stop,
      };
      const res = await post("sampath", "/api/sync/heartbeat", body);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({
        serverTime: clock.toISOString(),
        feedHead: expect.stringMatching(/^\d+$/),
        resetEpoch: 0,
      });
      const device = await prisma.device.findUniqueOrThrow({ where: { id: sessions.sampath.deviceId } });
      expect(device).toMatchObject({ appVersion: "1.4.0", pendingCount: 2, lastKnownStop: stop, lastSeenAt: clock });
      expect((await post("sampath", "/api/sync/heartbeat", { ...body, deviceId: randomUUID() })).statusCode).toBe(403);
      expect((await post("sampath", "/api/sync/heartbeat", body, { [CSRF_HEADER]: "nope" })).statusCode).toBe(403);
    });
  });
});
