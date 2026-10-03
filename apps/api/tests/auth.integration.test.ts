import { randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { Database } from "../src/lib/database";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE, type AuthConfig } from "../src/modules/auth";
import { scoped } from "../src/modules/policy";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping auth integration tests: set TEST_DATABASE_URL to a disposable _test database.");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = new Date("2026-10-03T08:00:00.000Z");
let clock = START;
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));
const auth: Partial<AuthConfig> = {
  sessionSecret: "integration-test-secret-integration-test",
  lockout: { threshold: 3, baseMs: 60_000, maxMs: 600_000 },
  loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
  fieldReauthGraceDays: 30,
};

/**
 * Accounts shaped like seed-and-demo.md §15.3. The seed (#30) has not landed; once it does, these tests should
 * sign in with the seeded set instead of creating their own.
 */
const PASSWORD = "demo-password";
const PIN = "4321";
type Login = Record<string, string>;
interface Account {
  name: string;
  login: Login;
  role: "STORE" | "DISPATCHER" | "LOADER" | "DRIVER";
}
const LOADER_DEVICE = randomUUID();
const DRIVER_DEVICE = randomUUID();
const accounts: Account[] = [
  { name: "store (outlet ID)", role: "STORE", login: { role: "STORE", loginId: "OUT015", password: PASSWORD } },
  {
    name: "store (email)",
    role: "STORE",
    login: { role: "STORE", loginId: "Dilini@Waypoint.test", password: PASSWORD },
  },
  { name: "second store", role: "STORE", login: { role: "STORE", loginId: "OUT016", password: PASSWORD } },
  {
    name: "dispatcher Nimal",
    role: "DISPATCHER",
    login: { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Peliyagoda" },
  },
  {
    name: "loader LDR001",
    role: "LOADER",
    login: { role: "LOADER", loginId: "LDR001", pin: PIN, deviceId: LOADER_DEVICE },
  },
  {
    name: "Kandy loader",
    role: "LOADER",
    login: { role: "LOADER", loginId: "LDR002", pin: PIN, deviceId: randomUUID() },
  },
  {
    name: "driver Sampath",
    role: "DRIVER",
    login: { role: "DRIVER", loginId: "DRV040", pin: PIN, deviceId: DRIVER_DEVICE },
  },
  {
    name: "driver DRV001 Ruwan S.",
    role: "DRIVER",
    login: { role: "DRIVER", loginId: "DRV001", pin: PIN, deviceId: randomUUID() },
  },
];

const ids = {} as Record<
  "out015" | "out016" | "kandyOutlet" | "veh001" | "veh040" | "orderA" | "orderB" | "kandyOrder",
  string
>;

async function seedFixtures(prisma: PrismaClient) {
  const district = (name: string, depot: string) =>
    prisma.district.create({
      data: {
        name,
        depot,
        roadClass: "urban",
        freeFlowKmh: 40,
        depotToDistrictKm: 10,
        depotToDistrictFreeflowMin: 15,
        interStopKm: 1,
        interStopFreeflowMin: 3,
      },
    });
  // The real day route (#45) runs the allocator, which needs the service allowance of every brand and dock in use.
  await prisma.serviceAllowance.create({ data: { brand: "Fresh", dockType: "rear_dock", minutes: 15 } });
  const colombo = await district("Colombo", "Peliyagoda");
  const kandy = await district("Kandy", "Kandy");
  const outlet = (displayId: string, districtId: string, depot: string) =>
    prisma.outlet.create({
      data: {
        displayId,
        brand: "Fresh",
        depot,
        dockType: "rear_dock",
        parkingConstraint: "normal",
        windowOpen: 300,
        windowClose: 600,
        districtId,
      },
    });
  ids.out015 = (await outlet("OUT015", colombo.id, "Peliyagoda")).id;
  ids.out016 = (await outlet("OUT016", colombo.id, "Peliyagoda")).id;
  ids.kandyOutlet = (await outlet("OUT101", kandy.id, "Kandy")).id;
  const vehicle = (displayId: string, depot: string) =>
    prisma.vehicle.create({
      data: {
        displayId,
        type: "van",
        temp: "reefer",
        weightCapKg: 1000,
        volumeCapM3: 10,
        fuelType: "diesel",
        kmPerL: 8,
        weeklyFuelQuotaL: 200,
        depot,
      },
    });
  ids.veh001 = (await vehicle("VEH001", "Peliyagoda")).id;
  ids.veh040 = (await vehicle("VEH040", "Kandy")).id;

  const password = await hashSecret(PASSWORD);
  const pin = await hashSecret(PIN);
  await prisma.user.createMany({
    data: [
      {
        loginId: "dilini@waypoint.test",
        role: "STORE",
        displayName: "Dilini",
        passwordHash: password,
        outletId: ids.out015,
      },
      { loginId: "OUT016", role: "STORE", displayName: "Second store", passwordHash: password, outletId: ids.out016 },
      { loginId: "nimal@waypoint.test", role: "DISPATCHER", displayName: "Nimal", passwordHash: password },
      {
        loginId: "kasun@waypoint.test",
        role: "DISPATCHER",
        displayName: "Peliyagoda only",
        passwordHash: password,
        depot: "Peliyagoda",
      },
      { loginId: "LDR001", role: "LOADER", displayName: "Peliyagoda loader", passwordHash: pin, depot: "Peliyagoda" },
      { loginId: "LDR002", role: "LOADER", displayName: "Kandy loader", passwordHash: pin, depot: "Kandy" },
      { loginId: "DRV040", role: "DRIVER", displayName: "Sampath", passwordHash: pin, vehicleId: ids.veh040 },
      { loginId: "DRV001", role: "DRIVER", displayName: "Ruwan S.", passwordHash: pin, vehicleId: ids.veh001 },
      { loginId: "LDR009", role: "LOADER", displayName: "No depot", passwordHash: pin },
    ],
  });

  const product = await prisma.product.create({
    data: {
      sku: "FR-MILK-1L",
      name: "Milk 1L",
      brand: "Fresh",
      tempRequirement: "chilled",
      unitLabel: "crate",
      unitWeightKg: 12,
      unitVolumeM3: 0.02,
    },
  });
  const order = (displayId: string, outletId: string) =>
    prisma.order.create({
      data: {
        orderLine_orderId: {
          create: [{ productId: product.id, qtyOrdered: 1, unitWeightKg: 12, unitVolumeM3: 0.02 }],
        },
        displayId,
        brand: "Fresh",
        tempRequirement: "chilled",
        requestedDate: new Date("2026-10-04"),
        currentDate: new Date("2026-10-04"),
        weightG: 1000,
        volumeL: 10,
        idempotencyKey: randomUUID(),
        outletId,
      },
    });
  ids.orderA = (await order("ORD1", ids.out015)).id;
  ids.orderB = (await order("ORD2", ids.out016)).id;
  ids.kandyOrder = (await order("ORD3", ids.kandyOutlet)).id;

  const day = await prisma.planningDay.create({ data: { depot: "Kandy", date: new Date("2026-10-04") } });
  const trip = await prisma.trip.create({
    data: {
      displayId: "T001",
      tripNo: 1,
      brand: "Fresh",
      plannedDepart: 210,
      plannedMinutes: 240,
      km: 50,
      litres: 6,
      planningDayId: day.id,
      vehicleId: ids.veh040,
      districtId: kandy.id,
    },
  });
  await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      seq: 1,
      etaMin: 300,
      windowOpen: 300,
      windowClose: 600,
      serviceMin: 15,
      orderId: ids.kandyOrder,
    },
  });
}

function sessionCookie(res: LightMyRequestResponse) {
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

describe.skipIf(!testDatabaseUrl)("auth and policy against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let database: Database;
  let prisma: PrismaClient;
  let app: App;

  async function login(body: Login, headers: Record<string, string> = { [CSRF_HEADER]: "1" }) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: body, headers });
  }
  async function signIn(body: Login) {
    const res = await login(body);
    expect(res.statusCode, res.body).toBe(200);
    return {
      cookies: { [SESSION_COOKIE]: sessionCookie(res).value },
      csrf: res.json().csrfToken as string,
      body: res.json(),
    };
  }

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue35");
    ({ prisma } = suite);
    database = suite.appDatabase;
    await seedFixtures(prisma);
    app = await buildServer({}, { database, auth, now: () => clock });
    await app.ready();
  });
  beforeEach(() => {
    clock = START;
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  describe("login", () => {
    it.each(accounts)("$name signs in, gets a session cookie and reads /auth/me", async ({ login: body, role }) => {
      const res = await login(body);
      expect(res.statusCode, res.body).toBe(200);
      const session = res.json();
      expect(session.user.role).toBe(role);
      expect(session.serverTime).toBe(START.toISOString());
      expect(session.csrfToken).toEqual(expect.any(String));
      const cookie = sessionCookie(res);
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/api" });
      // The signed cookie does not expose the raw session id.
      expect(cookie.value).not.toBe(session.user.id);

      const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: cookie.value } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user).toEqual(session.user);
      expect(me.json().csrfToken).toBe(session.csrfToken);
    });

    it("returns each role's scope", async () => {
      expect((await signIn(accounts[0]!.login)).body.user).toMatchObject({
        outletId: ids.out015,
        displayName: "Dilini",
      });
      expect((await signIn(accounts[3]!.login)).body.user.depots).toEqual(["Kandy", "Peliyagoda"]);
      expect((await signIn(accounts[4]!.login)).body.user.depot).toBe("Peliyagoda");
      expect((await signIn(accounts[6]!.login)).body.user.vehicleId).toBe(ids.veh040);
    });

    it("lets Nimal pick Kandy but refuses a depot outside a dispatcher's scope", async () => {
      await signIn({ role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Kandy" });
      const res = await login({ role: "DISPATCHER", email: "kasun@waypoint.test", password: PASSWORD, depot: "Kandy" });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("INVALID_CREDENTIALS");
      await signIn({ role: "DISPATCHER", email: "kasun@waypoint.test", password: PASSWORD, depot: "Peliyagoda" });
    });

    it("refuses wrong secrets, unknown IDs, the wrong role and an account without its scope", async () => {
      const refused: Login[] = [
        { role: "STORE", loginId: "OUT016", password: "nope" },
        { role: "STORE", loginId: "OUT099", password: PASSWORD },
        { role: "DRIVER", loginId: "DRV001", pin: "0000", deviceId: randomUUID() },
        { role: "DRIVER", loginId: "DRV002", pin: PIN, deviceId: randomUUID() },
        // Nimal exists, but not as a store manager.
        { role: "STORE", loginId: "nimal@waypoint.test", password: PASSWORD },
        { role: "LOADER", loginId: "LDR009", pin: PIN, deviceId: randomUUID() },
      ];
      for (const body of refused) {
        const res = await login(body);
        expect(res.statusCode, JSON.stringify(body)).toBe(401);
        expect(res.json()).toMatchObject({ code: "INVALID_CREDENTIALS", message_key: "errors.invalidCredentials" });
      }
    });

    it("stores server-side sessions with kind, device and sliding expiry", async () => {
      const web = await signIn(accounts[0]!.login);
      const field = await signIn(accounts[4]!.login);
      expect(web.body.expiresAt).toBe(new Date(START.getTime() + 12 * HOUR).toISOString());
      expect(field.body.expiresAt).toBe(new Date(START.getTime() + 14 * DAY).toISOString());
      const rows = await prisma.session.findMany({
        where: { user: { loginId: { in: ["dilini@waypoint.test", "LDR001"] } }, expiresAt: { gte: START } },
        include: { device: true },
        orderBy: { kind: "asc" },
      });
      expect(rows.map((r) => [r.kind, r.deviceId])).toContainEqual(["FIELD", LOADER_DEVICE]);
      expect(rows.map((r) => r.kind)).toContain("WEB");
      expect(rows.find((r) => r.kind === "FIELD")!.device).toMatchObject({ kind: "FIELD", appVersion: "unknown" });

      advance(11 * HOUR);
      const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: web.cookies });
      expect(me.statusCode).toBe(200);
      expect(me.json().expiresAt).toBe(new Date(clock.getTime() + 12 * HOUR).toISOString());
      expect(me.cookies.find((c) => c.name === SESSION_COOKIE)?.maxAge).toBe(12 * 60 * 60);

      advance(12 * HOUR);
      const expired = await app.inject({ method: "GET", url: "/api/auth/me", cookies: web.cookies });
      expect(expired.statusCode).toBe(401);
      expect(expired.json().message_key).toBe("errors.sessionExpired");
    });

    it("locks an account out with backoff after repeated failures", async () => {
      const wrong = { role: "STORE", loginId: "dilini@waypoint.test", password: "wrong" };
      for (let i = 0; i < 3; i++) expect((await login(wrong)).statusCode).toBe(401);
      expect((await login(wrong)).statusCode).toBe(401);
      const locked = await login({ ...wrong, password: PASSWORD });
      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toMatchObject({ code: "RATE_LIMITED", params: { retryAfterSeconds: 60 } });
      expect(locked.headers["retry-after"]).toBe("60");
      // Other accounts are unaffected; the lock lifts after the backoff.
      await signIn(accounts[2]!.login);
      advance(61_000);
      await signIn({ ...wrong, password: PASSWORD });
    });
  });

  describe("CSRF on mutations", () => {
    it("refuses a mutation without the custom header or with a wrong token", async () => {
      const { cookies, csrf } = await signIn(accounts[0]!.login);
      const missing = await app.inject({ method: "POST", url: "/api/auth/logout", cookies });
      expect(missing.statusCode).toBe(403);
      expect(missing.json()).toMatchObject({ code: "FORBIDDEN", message_key: "errors.csrfInvalid" });
      const wrong = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies,
        headers: { [CSRF_HEADER]: "x" },
      });
      expect(wrong.statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies })).statusCode).toBe(200);

      const ok = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies,
        headers: { [CSRF_HEADER]: csrf },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ ok: true, serverTime: START.toISOString() });
      expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies })).statusCode).toBe(401);
    });

    it("refuses another session's token", async () => {
      const a = await signIn(accounts[0]!.login);
      const b = await signIn(accounts[2]!.login);
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: a.cookies,
        headers: { [CSRF_HEADER]: b.csrf },
      });
      expect(res.statusCode).toBe(403);
    });

    it("refuses a login without the custom header", async () => {
      const res = await login(accounts[0]!.login, {});
      expect(res.statusCode).toBe(403);
    });
  });

  describe("field reauth (ADR 0024)", () => {
    const reauth = (session: { cookies: Record<string, string>; csrf: string }, body: Login) =>
      app.inject({
        method: "POST",
        url: "/api/auth/reauth",
        cookies: session.cookies,
        headers: { [CSRF_HEADER]: session.csrf },
        payload: body,
      });

    it("renews an expired FIELD session by PIN on the same device", async () => {
      const deviceId = randomUUID();
      const session = await signIn({ role: "DRIVER", loginId: "DRV001", pin: PIN, deviceId });
      advance(15 * DAY);
      expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: session.cookies })).statusCode).toBe(401);
      expect(await prisma.session.count({ where: { deviceId } })).toBe(1);

      expect((await reauth(session, { role: "DRIVER", pin: PIN, deviceId: randomUUID() })).statusCode).toBe(401);
      expect((await reauth(session, { role: "LOADER", pin: PIN, deviceId })).statusCode).toBe(401);
      const noHeader = await app.inject({
        method: "POST",
        url: "/api/auth/reauth",
        cookies: session.cookies,
        payload: { role: "DRIVER", pin: PIN, deviceId },
      });
      expect(noHeader.statusCode).toBe(403);

      const renewed = await reauth(session, { role: "DRIVER", pin: PIN, deviceId });
      expect(renewed.statusCode, renewed.body).toBe(200);
      expect(renewed.json().expiresAt).toBe(new Date(clock.getTime() + 14 * DAY).toISOString());
      expect(renewed.json().csrfToken).toBe(session.csrf);
      expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: session.cookies })).statusCode).toBe(200);
    });

    it("locks reauth for the session after wrong PINs and returns 429", async () => {
      const deviceId = randomUUID();
      const session = await signIn({ role: "LOADER", loginId: "LDR002", pin: PIN, deviceId });
      advance(15 * DAY);
      for (let i = 0; i < 4; i++)
        expect((await reauth(session, { role: "LOADER", pin: "0000", deviceId })).statusCode).toBe(401);
      const locked = await reauth(session, { role: "LOADER", pin: PIN, deviceId });
      expect(locked.statusCode).toBe(429);
      expect(locked.json().code).toBe("RATE_LIMITED");
      // The session is kept: the client's outbox survives and reauth works after the backoff.
      expect(await prisma.session.count({ where: { deviceId } })).toBe(1);
      advance(61_000);
      expect((await reauth(session, { role: "LOADER", pin: PIN, deviceId })).statusCode).toBe(200);
    });

    it("deletes the row and requires full login at the end of the grace window", async () => {
      const deviceId = randomUUID();
      const session = await signIn({ role: "DRIVER", loginId: "DRV040", pin: PIN, deviceId });
      advance(14 * DAY + 30 * DAY);
      const res = await reauth(session, { role: "DRIVER", pin: PIN, deviceId });
      expect(res.statusCode).toBe(401);
      expect(res.json().message_key).toBe("errors.sessionExpired");
      expect(await prisma.session.count({ where: { deviceId } })).toBe(0);
    });

    it("is refused for web roles and for revoked sessions", async () => {
      const store = await signIn(accounts[0]!.login);
      expect((await reauth(store, { role: "LOADER", pin: PIN, deviceId: randomUUID() })).statusCode).toBe(403);

      const deviceId = randomUUID();
      const field = await signIn({ role: "LOADER", loginId: "LDR001", pin: PIN, deviceId });
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: field.cookies,
        headers: { [CSRF_HEADER]: field.csrf },
      });
      expect((await reauth(field, { role: "LOADER", pin: PIN, deviceId })).statusCode).toBe(401);
    });
  });

  describe("policy and scoped()", () => {
    it("refuses a cross-scope read and allows the owner", async () => {
      const store = await signIn(accounts[0]!.login);
      const own = await app.inject({ method: "GET", url: `/api/store/orders/${ids.orderA}`, cookies: store.cookies });
      expect(own.statusCode).toBe(200);
      const other = await app.inject({ method: "GET", url: `/api/store/orders/${ids.orderB}`, cookies: store.cookies });
      expect(other.statusCode).toBe(403);
      expect(other.json()).toMatchObject({ code: "FORBIDDEN", message_key: "errors.forbidden" });
      const missing = await app.inject({
        method: "GET",
        url: `/api/store/orders/${randomUUID()}`,
        cookies: store.cookies,
      });
      expect(missing.statusCode).toBe(404);
    });

    it("keeps list queries inside the store's outlet", async () => {
      const store = await signIn(accounts[2]!.login);
      const res = await app.inject({ method: "GET", url: "/api/store/orders", cookies: store.cookies });
      expect(res.json().items.map((o: { id: string }) => o.id)).toEqual([ids.orderB]);
    });

    it("refuses another role's routes and a dispatcher's foreign depot", async () => {
      const driver = await signIn(accounts[6]!.login);
      const asDriver = await app.inject({
        method: "GET",
        url: `/api/store/orders/${ids.kandyOrder}`,
        cookies: driver.cookies,
      });
      expect(asDriver.statusCode).toBe(403);

      const kasun = await signIn({
        role: "DISPATCHER",
        email: "kasun@waypoint.test",
        password: PASSWORD,
        depot: "Peliyagoda",
      });
      const day = (depot: string) =>
        app.inject({ method: "GET", url: `/api/dispatch/days/2026-10-04?depot=${depot}`, cookies: kasun.cookies });
      expect((await day("Peliyagoda")).statusCode).toBe(200);
      expect((await day("Kandy")).statusCode).toBe(403);
    });

    it("scopes each role's queries against the database", async () => {
      const ordersFor = async (body: Login) => {
        const { body: session } = await signIn(body);
        const actor = await actorOf(session.user.id);
        return (await prisma.order.findMany({ where: scoped(actor).orders, select: { id: true } }))
          .map((r) => r.id)
          .sort();
      };
      const actorOf = async (userId: string) => {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          include: { outlet: true, vehicle: true },
        });
        switch (user.role) {
          case "STORE":
            return {
              role: "STORE" as const,
              userId,
              sessionId: "",
              outletId: user.outletId!,
              depot: user.outlet!.depot,
            };
          case "DISPATCHER":
            return {
              role: "DISPATCHER" as const,
              userId,
              sessionId: "",
              depots: user.depot ? [user.depot] : ["Kandy", "Peliyagoda"],
            };
          case "LOADER":
            return { role: "LOADER" as const, userId, sessionId: "", depot: user.depot!, deviceId: null };
          case "DRIVER":
            return {
              role: "DRIVER" as const,
              userId,
              sessionId: "",
              vehicleId: user.vehicleId!,
              depot: user.vehicle!.depot,
              deviceId: null,
            };
        }
      };
      expect(await ordersFor(accounts[0]!.login)).toEqual([ids.orderA]);
      expect(await ordersFor(accounts[3]!.login)).toEqual([ids.orderA, ids.orderB, ids.kandyOrder].sort());
      expect(await ordersFor(accounts[4]!.login)).toEqual([ids.orderA, ids.orderB].sort());
      expect(await ordersFor(accounts[5]!.login)).toEqual([ids.kandyOrder]);
      expect(await ordersFor(accounts[6]!.login)).toEqual([ids.kandyOrder]);
      expect(await ordersFor(accounts[7]!.login)).toEqual([]);

      const kandyLoader = await actorOf((await signIn(accounts[5]!.login)).body.user.id);
      expect(await prisma.trip.count({ where: scoped(kandyLoader).trips })).toBe(1);
      const ruwan = await actorOf((await signIn(accounts[7]!.login)).body.user.id);
      expect(await prisma.trip.count({ where: scoped(ruwan).trips })).toBe(0);
      expect(await prisma.outlet.count({ where: scoped(ruwan).outlets })).toBe(0);
      const sampath = await actorOf((await signIn(accounts[6]!.login)).body.user.id);
      expect(await prisma.outlet.findMany({ where: scoped(sampath).outlets, select: { id: true } })).toEqual([
        { id: ids.kandyOutlet },
      ]);
      const store = await actorOf((await signIn(accounts[0]!.login)).body.user.id);
      expect(await prisma.vehicle.count({ where: scoped(store).vehicles })).toBe(0);
    });
  });

  describe("transport rate limit", () => {
    it("returns 429 RATE_LIMITED when one client floods login", async () => {
      const limited = await buildServer(
        {},
        {
          database,
          auth: { ...auth, loginRateLimit: { max: 2, timeWindowMs: 60_000 } },
          now: () => clock,
        },
      );
      try {
        const attempt = () =>
          limited.inject({
            method: "POST",
            url: "/api/auth/login",
            headers: { [CSRF_HEADER]: "1" },
            payload: { role: "STORE", loginId: "OUT099", password: "x" },
          });
        expect((await attempt()).statusCode).toBe(401);
        expect((await attempt()).statusCode).toBe(401);
        const res = await attempt();
        expect(res.statusCode).toBe(429);
        expect(res.json()).toMatchObject({ code: "RATE_LIMITED", message_key: "errors.rateLimited" });
      } finally {
        await limited.close();
      }
    });
  });
});
