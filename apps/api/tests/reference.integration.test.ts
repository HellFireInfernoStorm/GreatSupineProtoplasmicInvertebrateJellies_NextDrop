// Reference reads over the real seed (ADR 0038): every judge account gets a non-empty, scoped answer.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DEMO_PIN, DISPATCHER_LOGIN_ID } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import {
  HILL_RUN_DEPOT,
  HILL_STORE_OUTLET_ID,
  PEAK_DAY_DEPOT,
  PEAK_STORE_OUTLET_ID,
  STORY_DATE,
  WALKTHROUGH_DRIVER_ID,
  WALKTHROUGH_VEHICLE_ID,
} from "../prisma/seed/story-fixtures";
import { CSRF_HEADER, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl) console.info("Skipping reference tests: set TEST_DATABASE_URL to a disposable _test database.");

type Who = "store" | "dispatcher" | "loader" | "driver";
const LOGINS: Record<Who, Record<string, string>> = {
  store: { role: "STORE", loginId: PEAK_STORE_OUTLET_ID, password: DEMO_PASSWORD },
  dispatcher: { role: "DISPATCHER", email: DISPATCHER_LOGIN_ID, password: DEMO_PASSWORD, depot: PEAK_DAY_DEPOT },
  loader: { role: "LOADER", loginId: "LDR001", pin: DEMO_PIN, deviceId: randomUUID() },
  driver: { role: "DRIVER", loginId: WALKTHROUGH_DRIVER_ID, pin: DEMO_PIN, deviceId: randomUUID() },
};

describe.skipIf(!testDatabaseUrl)("reference API over the seed", () => {
  let suite: SuiteDatabase;
  let app: App;
  const cookies = {} as Record<Who, string>;

  const get = async (who: Who, url: string) => {
    const res = await app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: cookies[who] } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const items = async <T>(who: Who, url: string): Promise<T[]> => (await get(who, url)).items as T[];

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue110ref");
    await runSeed(suite.prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => new Date("2026-09-28T04:30:00.000Z") });
    await app.ready();
    for (const who of Object.keys(LOGINS) as Who[]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: LOGINS[who],
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.statusCode, res.body).toBe(200);
      cookies[who] = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    }
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it("gives a store its own outlet and its brand's catalogue", async () => {
    const outlets = await items<{ displayId: string; brand: string; name: string; address: null }>(
      "store",
      "/api/ref/outlets",
    );
    expect(outlets.map((o) => o.displayId)).toEqual([PEAK_STORE_OUTLET_ID]);
    const outlet = outlets[0]!;
    expect(outlet.name).toBe(`Waypoint ${outlet.brand}, Colombo`);
    expect(outlet.address).toBeNull();

    const products = await items<{ brand: string; unitWeightG: number }>("store", "/api/ref/products");
    expect(products.length).toBeGreaterThan(0);
    expect(new Set(products.map((p) => p.brand))).toEqual(new Set([outlet.brand]));
    const all = await items<{ brand: string }>("dispatcher", "/api/ref/products");
    expect(all.length).toBeGreaterThan(products.length);

    // A store sees no fleet unless a vehicle carries one of its orders, and never another depot's.
    const vehicles = await items<{ depot: string }>("store", "/api/ref/vehicles");
    expect(vehicles.every((v) => v.depot === PEAK_DAY_DEPOT)).toBe(true);
  });

  it("gives a dispatcher every depot it may plan, narrowed by ?depot=", async () => {
    // Nimal has no depot pin, so every reference depot is in scope (ADR 0028).
    const outlets = await items<{ depot: string }>("dispatcher", "/api/ref/outlets");
    expect(outlets).toHaveLength(await suite.prisma.outlet.count());
    const kandy = await items<{ depot: string }>("dispatcher", `/api/ref/outlets?depot=${HILL_RUN_DEPOT}`);
    expect(kandy.length).toBeGreaterThan(0);
    expect(kandy.every((o) => o.depot === HILL_RUN_DEPOT)).toBe(true);

    const vehicles = await items<{ depot: string; weightCapG: number; volumeCapL: number; driver: { phone: string } }>(
      "dispatcher",
      `/api/ref/vehicles?depot=${PEAK_DAY_DEPOT}`,
    );
    expect(vehicles.length).toBeGreaterThan(0);
    for (const v of vehicles) {
      expect(v.depot).toBe(PEAK_DAY_DEPOT);
      expect(Number.isInteger(v.weightCapG) && Number.isInteger(v.volumeCapL)).toBe(true);
      expect(v.driver.phone).toBeTruthy();
    }
  });

  it("keeps a loader in its depot: another depot's filter returns nothing", async () => {
    const outlets = await items<{ depot: string }>("loader", "/api/ref/outlets");
    expect(outlets.length).toBeGreaterThan(0);
    expect(outlets.every((o) => o.depot === PEAK_DAY_DEPOT)).toBe(true);
    const vehicles = await items<{ depot: string }>("loader", "/api/ref/vehicles");
    expect(vehicles.length).toBeGreaterThan(0);
    expect(vehicles.every((v) => v.depot === PEAK_DAY_DEPOT)).toBe(true);
    expect(await items("loader", `/api/ref/outlets?depot=${HILL_RUN_DEPOT}`)).toEqual([]);
    expect(await items("loader", `/api/ref/vehicles?depot=${HILL_RUN_DEPOT}`)).toEqual([]);
  });

  it("gives a driver its own vehicle and the outlets on its trips", async () => {
    const vehicles = await items<{ displayId: string }>("driver", "/api/ref/vehicles");
    expect(vehicles.map((v) => v.displayId)).toEqual([WALKTHROUGH_VEHICLE_ID]);
    // The seed has no trips (the walkthrough plans them), so the driver sees no outlets yet.
    expect(await items("driver", "/api/ref/outlets")).toEqual([]);

    // Put the hill store's story order on a trip of the driver's vehicle: that outlet, and only it, appears.
    const prisma = suite.prisma;
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { displayId: WALKTHROUGH_VEHICLE_ID } });
    const order = await prisma.order.findFirstOrThrow({
      where: { outlet: { displayId: HILL_STORE_OUTLET_ID }, currentDate: new Date(`${STORY_DATE}T00:00:00Z`) },
      include: { outlet: true },
    });
    const day = await prisma.planningDay.upsert({
      where: { depot_date: { depot: HILL_RUN_DEPOT, date: order.currentDate } },
      update: {},
      create: { depot: HILL_RUN_DEPOT, date: order.currentDate },
    });
    const trip = await prisma.trip.create({
      data: {
        displayId: "TRP-REF-1",
        tripNo: 1,
        brand: order.brand,
        plannedDepart: 360,
        plannedMinutes: 240,
        km: 80,
        litres: 10,
        planningDayId: day.id,
        vehicleId: vehicle.id,
        districtId: order.outlet.districtId,
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        seq: 1,
        etaMin: 480,
        windowOpen: 420,
        windowClose: 720,
        serviceMin: 20,
        orderId: order.id,
      },
    });
    const outlets = await items<{ displayId: string }>("driver", "/api/ref/outlets");
    expect(outlets.map((o) => o.displayId)).toEqual([HILL_STORE_OUTLET_ID]);
  });

  it("answers the calendar and reasons the same for every role", async () => {
    const range = "/api/ref/calendar?from=2026-09-27&to=2026-10-03";
    const days = await items<{ date: string; isOperating: boolean }>("store", range);
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    // Sunday is not an operating day (spec/rules-core).
    expect(days[0]!.isOperating).toBe(false);
    const reasons = await get("store", "/api/ref/reasons");
    for (const who of ["dispatcher", "loader", "driver"] as const) {
      expect(await items(who, range)).toEqual(days);
      expect(await get(who, "/api/ref/reasons")).toEqual(reasons);
    }
  });

  it("refuses a reversed or over-long calendar range", async () => {
    for (const query of ["from=2026-10-03&to=2026-10-01", "from=2026-01-01&to=2027-01-02"]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/ref/calendar?${query}`,
        cookies: { [SESSION_COOKIE]: cookies.store },
      });
      expect(res.statusCode, query).toBe(400);
      expect(res.json()).toMatchObject({ code: "SCHEMA_INVALID" });
    }
    const longest = await items("store", "/api/ref/calendar?from=2026-01-01&to=2027-01-01");
    expect(longest).toHaveLength(366);
  });

  it("requires a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ref/products" });
    expect(res.statusCode).toBe(401);
  });
});
