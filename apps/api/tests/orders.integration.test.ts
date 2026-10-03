import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping orders integration tests: set TEST_DATABASE_URL to a disposable _test database.");

const PASSWORD = "demo-password";
/** Fri 2 Oct 2026, 15:30 Asia/Colombo: half an hour before the cutoff for Sat 3 Oct. */
const BEFORE_CUTOFF = new Date("2026-10-02T10:00:00.000Z");
/** Fri 2 Oct 2026, 16:01 Asia/Colombo. */
const AFTER_CUTOFF = new Date("2026-10-02T10:31:00.000Z");
let clock = BEFORE_CUTOFF;

const ids = {} as Record<
  "out004" | "out005" | "milk" | "eggs" | "rice" | "shirt" | "vehicle" | "driver" | "dispatcher" | "district",
  string
>;

async function seed(prisma: PrismaClient) {
  const colombo = await prisma.district.create({
    data: {
      name: "Colombo",
      depot: "Peliyagoda",
      roadClass: "urban",
      freeFlowKmh: 40,
      depotToDistrictKm: 10,
      depotToDistrictFreeflowMin: 15,
      interStopKm: 1,
      interStopFreeflowMin: 3,
    },
  });
  ids.district = colombo.id;
  const outlet = async (displayId: string) =>
    (
      await prisma.outlet.create({
        data: {
          displayId,
          brand: "Fresh",
          depot: "Peliyagoda",
          dockType: "rear_dock",
          parkingConstraint: "normal",
          mallWindow: "10:00-22:00",
          windowOpen: 300,
          windowClose: 480,
          districtId: colombo.id,
        },
      })
    ).id;
  ids.out004 = await outlet("OUT004");
  ids.out005 = await outlet("OUT005");
  const product = async (sku: string, brand: "Fresh" | "Style", temp: "chilled" | "ambient", kg: string, m3: string) =>
    (
      await prisma.product.create({
        data: { sku, name: sku, brand, tempRequirement: temp, unitLabel: "crate", unitWeightKg: kg, unitVolumeM3: m3 },
      })
    ).id;
  ids.milk = await product("FR-MILK", "Fresh", "chilled", "12.5", "0.0205");
  ids.eggs = await product("FR-EGGS", "Fresh", "chilled", "6.25", "0.0300");
  ids.rice = await product("FR-RICE", "Fresh", "ambient", "25", "0.03");
  ids.shirt = await product("ST-SHIRT", "Style", "ambient", "0.3", "0.002");
  ids.vehicle = (
    await prisma.vehicle.create({
      data: {
        displayId: "VEH001",
        type: "truck",
        temp: "reefer",
        weightCapKg: 3000,
        volumeCapM3: 20,
        fuelType: "diesel",
        kmPerL: 6,
        weeklyFuelQuotaL: 300,
        depot: "Peliyagoda",
      },
    })
  ).id;
  // Mon 5 Oct 2026 is a non-operating holiday, so Saturday's late orders roll to Tuesday.
  await prisma.calendarDay.create({
    data: {
      date: new Date("2026-10-05"),
      dow: 0,
      isoYear: 2026,
      isoWeek: 41,
      isPayday: false,
      festivalRamp: 0,
      isHoliday: true,
      monsoon: false,
      isOperating: false,
    },
  });
  const password = await hashSecret(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      {
        loginId: "dilini@waypoint.test",
        role: "STORE",
        displayName: "Dilini",
        passwordHash: password,
        outletId: ids.out004,
      },
      { loginId: "OUT005", role: "STORE", displayName: "Second store", passwordHash: password, outletId: ids.out005 },
      {
        loginId: "nimal@waypoint.test",
        role: "DISPATCHER",
        displayName: "Nimal",
        passwordHash: password,
        depot: "Peliyagoda",
      },
      { loginId: "DRV001", role: "DRIVER", displayName: "Ruwan S.", passwordHash: password, vehicleId: ids.vehicle },
    ],
    select: { id: true, loginId: true },
  });
  ids.dispatcher = users.find((u) => u.loginId === "nimal@waypoint.test")!.id;
  ids.driver = users.find((u) => u.loginId === "DRV001")!.id;
}

describe.skipIf(!testDatabaseUrl)("store orders API against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<"dilini" | "second" | "nimal", { cookie: string; csrf: string }>;

  const as = (who: keyof typeof sessions) => ({
    get: (url: string) => app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: sessions[who].cookie } }),
    post: (url: string, payload: object, headers: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url,
        payload,
        cookies: { [SESSION_COOKIE]: sessions[who].cookie },
        headers: { [CSRF_HEADER]: sessions[who].csrf, ...headers },
      }),
  });
  const place = (who: keyof typeof sessions, body: object, key = randomUUID()) =>
    as(who).post("/api/store/orders", body, { "idempotency-key": key });
  const milkOrder = (requestedDate = "2026-10-03") => ({
    requestedDate,
    lines: [
      { productId: ids.milk, qty: 2 },
      { productId: ids.eggs, qty: 1 },
    ],
  });

  /** Simulate planning and delivery by appending the server events and status a real run would produce. */
  let runDay = 0;
  async function deliver(orderId: string) {
    // One planning day per simulated run keeps (day, vehicle, tripNo) unique.
    const day = await prisma.planningDay.create({
      data: { depot: "Peliyagoda", date: new Date(Date.UTC(2026, 9, 3) + runDay++ * 86_400_000), state: "IN_PROGRESS" },
    });
    const trip = await prisma.trip.create({
      data: {
        displayId: `T${randomUUID().slice(0, 6)}`,
        tripNo: 1,
        brand: "Fresh",
        status: "DEPARTED",
        plannedDepart: 210,
        plannedMinutes: 240,
        km: 42.5,
        litres: 7.083,
        planningDayId: day.id,
        vehicleId: ids.vehicle,
        districtId: ids.district,
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        tripStatus: "DEPARTED",
        seq: 1,
        etaMin: 372,
        windowOpen: 300,
        windowClose: 480,
        serviceMin: 15,
        orderId,
      },
    });
    const base = {
      source: "SERVER" as const,
      actorRole: "DISPATCHER" as const,
      actorUserId: ids.dispatcher,
      orderId,
    };
    const events: Prisma.OrderEventCreateManyInput[] = [
      {
        ...base,
        type: "ORDER_PLANNED",
        capturedAt: clock,
        payload: { tripId: trip.id, vehicleId: ids.vehicle, seq: 1, etaFrom: clock, etaTo: clock, planVersion: 1 },
      },
      { ...base, type: "ORDER_OUT_FOR_DELIVERY", capturedAt: clock, payload: { tripId: trip.id } },
      {
        ...base,
        actorRole: "DRIVER",
        actorUserId: ids.driver,
        type: "STOP_OUTCOME",
        capturedAt: new Date("2026-10-03T00:42:00.000Z"),
        receivedAt: new Date("2026-10-03T02:10:00.000Z"),
        clockOffsetMs: 1500n,
        payload: { outcome: "FULL", lines: [] },
      },
    ];
    for (const event of events) await prisma.orderEvent.create({ data: event });
    await prisma.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
    return trip;
  }

  const logins = {
    dilini: { role: "STORE", loginId: "OUT004", password: PASSWORD },
    second: { role: "STORE", loginId: "OUT005", password: PASSWORD },
    nimal: { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Peliyagoda" },
  };
  /** Sign in at the current test clock (web sessions last 12 h of that clock). */
  async function signIn(who: keyof typeof sessions) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: logins[who],
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.statusCode, res.body).toBe(200);
    sessions[who] = { cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value, csrf: res.json().csrfToken };
  }

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue42");
    prisma = suite.prisma;
    await seed(prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    for (const who of Object.keys(logins) as (keyof typeof sessions)[]) await signIn(who);
  });
  beforeEach(() => {
    clock = BEFORE_CUTOFF;
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  describe("GET /store/cutoff", () => {
    it("is open before 16:00 on D-1 by the server clock", async () => {
      const res = await as("dilini").get("/api/store/cutoff?date=2026-10-03");
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({
        serverTime: BEFORE_CUTOFF.toISOString(),
        requestedDate: "2026-10-03",
        deliveryDate: "2026-10-03",
        cutoffAt: "2026-10-02T10:30:00.000Z",
        orderingOpen: true,
        guidanceKey: "ordering.fresh.separateChilled",
      });
    });

    it("rolls past Sunday and the Monday holiday after the cutoff", async () => {
      clock = AFTER_CUTOFF;
      const body = (await as("dilini").get("/api/store/cutoff?date=2026-10-03")).json();
      expect(body).toMatchObject({
        deliveryDate: "2026-10-06",
        orderingOpen: false,
        cutoffAt: "2026-10-05T10:30:00.000Z",
      });
      const sunday = (await as("dilini").get("/api/store/cutoff?date=2026-10-04")).json();
      expect(sunday.guidanceKey).toBe("ordering.nonOperatingDay");
    });

    it("is store-only", async () => {
      expect((await as("nimal").get("/api/store/cutoff?date=2026-10-03")).statusCode).toBe(403);
    });
  });

  describe("POST /store/orders", () => {
    it("places an order with totals from the lines, an ORDER_PLACED event and a feed row", async () => {
      const before = (await prisma.feedCounter.findUniqueOrThrow({ where: { singleton: true } })).head;
      const res = await place("dilini", milkOrder());
      expect(res.statusCode, res.body).toBe(201);
      const order = res.json();
      expect(order).toMatchObject({
        displayId: expect.stringMatching(/^ORD\d{5}$/),
        outletId: ids.out004,
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: "2026-10-03",
        currentDate: "2026-10-03",
        status: "ORDERED",
        // 2 x 12.5 kg + 6.25 kg; 2 x 20.5 L + 30 L.
        weightG: 31250,
        volumeL: 71,
        placedAt: BEFORE_CUTOFF.toISOString(),
        confirmedAt: null,
        assignment: null,
        deferral: null,
        flags: { short: [], damaged: [] },
      });
      expect(order.lines).toHaveLength(2);
      expect(order.lines[0]).toMatchObject({ sku: "FR-MILK", qtyOrdered: 2, unitWeightG: 12500, unitVolumeM3: 0.0205 });

      const detail = (await as("dilini").get(`/api/store/orders/${order.id}`)).json();
      expect(detail.timeline).toHaveLength(1);
      expect(detail.timeline[0]).toMatchObject({
        type: "ORDER_PLACED",
        source: "SERVER",
        actor: { role: "STORE" },
        subject: { orderId: order.id },
        disposition: "APPLIED",
        capturedAt: BEFORE_CUTOFF.toISOString(),
        payload: {
          requestedDate: "2026-10-03",
          lines: [
            { lineId: order.lines[0].id, skuId: "FR-MILK", qty: 2 },
            { lineId: order.lines[1].id, skuId: "FR-EGGS", qty: 1 },
          ],
        },
      });
      const feed = await prisma.changeFeed.findMany({ where: { seq: { gt: before } } });
      expect(feed).toEqual([
        expect.objectContaining({
          kind: "order_changed",
          entityId: order.id,
          outletId: ids.out004,
          depot: "Peliyagoda",
          roles: ["STORE", "DISPATCHER", "LOADER"],
        }),
      ]);
    });

    it("rolls an order placed after the cutoff to the next operating day", async () => {
      clock = AFTER_CUTOFF;
      const order = (await place("dilini", milkOrder())).json();
      expect(order).toMatchObject({ requestedDate: "2026-10-03", currentDate: "2026-10-06" });
    });

    it("keeps the separate dry order for the same outlet and day", async () => {
      const dry = await place("dilini", { requestedDate: "2026-10-03", lines: [{ productId: ids.rice, qty: 3 }] });
      expect(dry.statusCode).toBe(201);
      expect(dry.json().tempRequirement).toBe("ambient");
    });

    it("is idempotent per outlet and key, including concurrent retries", async () => {
      const key = randomUUID();
      const first = (await place("dilini", milkOrder(), key)).json();
      const retry = await place("dilini", milkOrder(), key);
      expect(retry.statusCode).toBe(201);
      expect(retry.json().id).toBe(first.id);
      expect(await prisma.orderEvent.count({ where: { orderId: first.id } })).toBe(1);
      const other = (await place("second", milkOrder(), key)).json();
      expect(other.id).not.toBe(first.id);

      const raced = randomUUID();
      const results = await Promise.all([place("dilini", milkOrder(), raced), place("dilini", milkOrder(), raced)]);
      expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(results[0]!.json().id).toBe(results[1]!.json().id);
      expect(await prisma.order.count({ where: { idempotencyKey: `${ids.out004}:${raced}` } })).toBe(1);
    });

    it("allocates distinct, increasing display IDs", async () => {
      const a = (await place("dilini", milkOrder())).json().displayId as string;
      const b = (await place("second", milkOrder())).json().displayId as string;
      expect(Number(b.slice(3))).toBe(Number(a.slice(3)) + 1);
    });

    it("refuses mixed temperatures, other brands, unknown or repeated products", async () => {
      const cases = [
        [
          { productId: ids.milk, qty: 1 },
          { productId: ids.rice, qty: 1 },
        ],
        [{ productId: ids.shirt, qty: 1 }],
        [{ productId: randomUUID(), qty: 1 }],
        [
          { productId: ids.milk, qty: 1 },
          { productId: ids.milk, qty: 2 },
        ],
      ];
      for (const lines of cases) {
        const res = await place("dilini", { requestedDate: "2026-10-03", lines });
        expect(res.statusCode, JSON.stringify(lines)).toBe(422);
        expect(res.json().code).toBe("VALIDATION_FAILED");
      }
      expect(
        (await place("dilini", { ...milkOrder(), replacesOrderId: (await place("second", milkOrder())).json().id }))
          .statusCode,
      ).toBe(422);
    });

    it("requires the idempotency key and the CSRF header", async () => {
      expect((await as("dilini").post("/api/store/orders", milkOrder())).statusCode).toBe(400);
      const noCsrf = await app.inject({
        method: "POST",
        url: "/api/store/orders",
        payload: milkOrder(),
        cookies: { [SESSION_COOKIE]: sessions.dilini.cookie },
        headers: { "idempotency-key": randomUUID() },
      });
      expect(noCsrf.statusCode).toBe(403);
    });
  });

  describe("reads", () => {
    it("refuses a cross-outlet read and lists only the store's own orders", async () => {
      const mine = (await place("dilini", milkOrder())).json();
      const theirs = (await place("second", milkOrder())).json();
      expect((await as("second").get(`/api/store/orders/${mine.id}`)).statusCode).toBe(403);
      expect((await as("second").post(`/api/store/orders/${mine.id}/cancel`, {})).statusCode).toBe(403);
      expect((await as("dilini").get(`/api/store/orders/${randomUUID()}`)).statusCode).toBe(404);
      const list = (await as("second").get("/api/store/orders?limit=100")).json();
      expect(list.items.every((o: { outletId: string }) => o.outletId === ids.out005)).toBe(true);
      expect(list.items.map((o: { id: string }) => o.id)).toContain(theirs.id);
    });

    it("pages newest first and filters by date and status", async () => {
      const ids3 = [];
      for (let i = 0; i < 3; i++) ids3.push((await place("second", milkOrder("2026-10-08"))).json().id);
      const page1 = (await as("second").get("/api/store/orders?date=2026-10-08&limit=2")).json();
      expect(page1.items.map((o: { id: string }) => o.id)).toEqual([ids3[2], ids3[1]]);
      const page2 = (
        await as("second").get(`/api/store/orders?date=2026-10-08&limit=2&after=${page1.nextCursor}`)
      ).json();
      expect(page2.items.map((o: { id: string }) => o.id)).toEqual([ids3[0]]);
      expect(page2.nextCursor).toBeNull();
      const cancelled = (await as("second").get("/api/store/orders?status=CANCELLED&date=2026-10-08")).json();
      expect(cancelled.items).toEqual([]);
      expect((await as("second").get("/api/store/orders?after=nope")).statusCode).toBe(400);
    });
  });

  describe("cancel, receipt and issues", () => {
    it("cancels an order before planning and refuses a second cancel", async () => {
      const order = (await place("dilini", milkOrder())).json();
      const res = await as("dilini").post(`/api/store/orders/${order.id}/cancel`, { reason: "duplicate" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status).toBe("CANCELLED");
      const again = await as("dilini").post(`/api/store/orders/${order.id}/cancel`, {});
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: "ILLEGAL_TRANSITION", params: { from: "CANCELLED" } });
      const timeline = (await as("dilini").get(`/api/store/orders/${order.id}`)).json().timeline;
      expect(timeline.map((e: { type: string }) => e.type)).toEqual(["ORDER_PLACED", "ORDER_CANCELLED"]);
    });

    it("refuses receipt before delivery", async () => {
      const order = (await place("dilini", milkOrder())).json();
      const res = await as("dilini").post(`/api/store/orders/${order.id}/receipt`, {
        lines: [{ lineId: order.lines[0].id, qtyReceived: 2 }],
      });
      expect(res.statusCode).toBe(409);
    });

    it("confirms receipt of a delivered order with received quantities", async () => {
      const order = (await place("dilini", milkOrder())).json();
      await deliver(order.id);
      const unknown = await as("dilini").post(`/api/store/orders/${order.id}/receipt`, {
        lines: [{ lineId: randomUUID(), qtyReceived: 1 }],
      });
      expect(unknown.statusCode).toBe(422);
      const res = await as("dilini").post(`/api/store/orders/${order.id}/receipt`, {
        lines: [
          { lineId: order.lines[0].id, qtyReceived: 2 },
          { lineId: order.lines[1].id, qtyReceived: 1 },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status).toBe("RECEIVED");
      expect(res.json().lines.map((l: { qtyReceived: number }) => l.qtyReceived)).toEqual([2, 1]);
      const detail = (await as("dilini").get(`/api/store/orders/${order.id}`)).json();
      expect(detail.timeline.map((e: { type: string }) => e.type)).toEqual([
        "ORDER_PLACED",
        "ORDER_PLANNED",
        "ORDER_OUT_FOR_DELIVERY",
        "STOP_OUTCOME",
        "RECEIPT_CONFIRMED",
      ]);
      // Field facts keep their device capture time and clock offset next to the server receipt time.
      expect(detail.timeline[3]).toMatchObject({
        capturedAt: "2026-10-03T00:42:00.000Z",
        receivedAt: "2026-10-03T02:10:00.000Z",
        clockOffsetMs: 1500,
      });
    });

    it("reports an issue: DISPUTED, issue id = event id, and the depot's dispatcher is notified", async () => {
      const order = (await place("dilini", milkOrder())).json();
      await deliver(order.id);
      const res = await as("dilini").post(`/api/store/orders/${order.id}/issues`, {
        kind: "WARM",
        lines: [{ lineId: order.lines[0].id, qty: 1 }],
        note: "one warm crate",
      });
      expect(res.statusCode, res.body).toBe(201);
      const { issueId, order: disputed } = res.json();
      expect(disputed.status).toBe("DISPUTED");
      const event = await prisma.orderEvent.findUniqueOrThrow({ where: { id: issueId } });
      expect(event.type).toBe("ISSUE_REPORTED");
      const inbox = (await as("nimal").get("/api/notifications")).json();
      expect(inbox.items[0]).toMatchObject({
        kind: "dispute_opened",
        group: "NEEDS_ACTION",
        entityRef: { type: "issue", id: issueId },
        params: { order: order.displayId, issueKind: "WARM" },
      });
    });

    it("records a second issue on a disputed order, and refuses a dispute after receipt (RECEIVED is terminal)", async () => {
      const disputed = (await place("dilini", milkOrder())).json();
      await deliver(disputed.id);
      await as("dilini").post(`/api/store/orders/${disputed.id}/issues`, { kind: "WARM" });
      const second = await as("dilini").post(`/api/store/orders/${disputed.id}/issues`, { kind: "DAMAGED" });
      expect(second.statusCode, second.body).toBe(201);
      expect(second.json().order.status).toBe("DISPUTED");
      expect(await prisma.orderEvent.count({ where: { orderId: disputed.id, type: "ISSUE_REPORTED" } })).toBe(2);

      const received = (await place("dilini", milkOrder())).json();
      await deliver(received.id);
      await as("dilini").post(`/api/store/orders/${received.id}/receipt`, {
        lines: [{ lineId: received.lines[0].id, qtyReceived: 2 }],
      });
      const late = await as("dilini").post(`/api/store/orders/${received.id}/issues`, { kind: "WARM" });
      expect(late.statusCode).toBe(409);
      const again = await as("dilini").post(`/api/store/orders/${received.id}/receipt`, {
        lines: [{ lineId: received.lines[0].id, qtyReceived: 2 }],
      });
      expect(again.statusCode).toBe(409);
    });
  });

  describe("GET /store/deliveries", () => {
    it("shows the store's own stop with ETA band, double timestamps and no-signal state", async () => {
      clock = new Date("2026-10-03T03:00:00.000Z");
      await signIn("dilini");
      await signIn("second");
      const placed = await place("dilini", milkOrder("2026-10-03"));
      expect(placed.statusCode, placed.body).toBe(201);
      const mine = placed.json();
      const theirs = (await place("second", milkOrder("2026-10-03"))).json();
      // Force both onto the same trip; the second store's stop must not leak.
      const trip = await deliver(mine.id);
      const runDate = (await prisma.planningDay.findUniqueOrThrow({ where: { id: trip.planningDayId } })).date
        .toISOString()
        .slice(0, 10);
      await prisma.tripStop.create({
        data: {
          tripId: trip.id,
          tripStatus: "DEPARTED",
          seq: 2,
          etaMin: 400,
          windowOpen: 300,
          windowClose: 480,
          serviceMin: 15,
          orderId: theirs.id,
        },
      });
      await prisma.order.updateMany({
        where: { id: { in: [mine.id, theirs.id] } },
        data: { currentDate: new Date("2026-10-09") },
      });
      await prisma.device.create({
        data: {
          id: randomUUID(),
          kind: "FIELD",
          appVersion: "1",
          lastSeenAt: new Date("2026-10-03T00:48:00.000Z"),
          userId: ids.driver,
        },
      });

      const res = await as("dilini").get("/api/store/deliveries?date=2026-10-09");
      expect(res.statusCode, res.body).toBe(200);
      const [item] = res.json().items;
      expect(res.json().items).toHaveLength(1);
      expect(item.signal).toBe("NO_SIGNAL");
      expect(item.lastHeardAt).toBe("2026-10-03T00:48:00.000Z");
      expect(item.order.assignment).toMatchObject({
        tripId: trip.id,
        vehicleId: ids.vehicle,
        seq: 1,
        // ETA 06:12 Colombo, banded to 05:55-06:25.
        etaFrom: `${runDate}T00:25:00.000Z`,
        etaTo: `${runDate}T00:55:00.000Z`,
      });
      expect(item.trip).toMatchObject({ status: "DEPARTED", district: "Colombo", distanceM: 42500, fuelMl: 7083 });
      expect(item.trip.stops).toHaveLength(1);
      expect(item.trip.stops[0]).toMatchObject({
        deliveredAt: "2026-10-03T00:42:00.000Z",
        confirmedAt: "2026-10-03T02:10:00.000Z",
        outlet: {
          name: "Waypoint Fresh, Colombo",
          mallWindow: { open: 600, close: 1320 },
          contact: { name: "Dilini", phone: null },
          address: null,
        },
      });

      clock = new Date("2026-10-03T00:50:00.000Z");
      const recent = (await as("dilini").get("/api/store/deliveries?date=2026-10-09")).json();
      expect(recent.items[0].signal).toBe("ONLINE");
    });
  });
});
