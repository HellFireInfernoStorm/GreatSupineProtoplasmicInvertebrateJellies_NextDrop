// Planning API against the seeded peak day in PostgreSQL (issue #45).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ApiDto } from "@nextdrop/contracts";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DISPATCHER_LOGIN_ID } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import { PEAK_DAY_WORKSHOP } from "../prisma/seed/peak-day";
import { HILL_RUN_WORKSHOP } from "../prisma/seed/story";
import { createDatabase, type Database } from "../src/lib/database";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { fuelUsedThisWeek } from "../src/modules/planning";
import { buildServer, type App } from "../src/server";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test.");
}
const schema = `issue45_${randomUUID().replaceAll("-", "")}`;
const suiteUrl = url ? new URL(url) : undefined;
suiteUrl?.searchParams.set("schema", schema);
const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
const DATE = "2026-09-29";
const PELIYAGODA = `/api/dispatch/days/${DATE}`;
const peliyagoda = (path = "") => `${PELIYAGODA}${path}?depot=Peliyagoda`;
let database: Database;
let app: App;
type Session = { cookies: Record<string, string>; csrf: string };
let nimal: Session;

async function signIn(payload: object): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload, headers: { [CSRF_HEADER]: "1" } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
  return { cookies: { [SESSION_COOKIE]: cookie.value }, csrf: res.json().csrfToken as string };
}

function call(session: Session, method: "GET" | "POST" | "PUT", path: string, payload?: object) {
  return app.inject({
    method,
    url: path,
    cookies: session.cookies,
    headers: method === "GET" ? {} : { [CSRF_HEADER]: session.csrf },
    ...(payload ? { payload } : {}),
  }) as Promise<LightMyRequestResponse>;
}

describe.skipIf(!url)("planning API (PostgreSQL)", () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
    await promisify(execFile)(process.execPath, [cli, "migrate", "deploy"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: suiteUrl!.toString() },
      timeout: 60000,
    });
    database = createDatabase(suiteUrl!.toString());
    await runSeed(database.prisma!);
    app = await buildServer(
      {},
      {
        database: { ...database, close: async () => {} },
        auth: {
          sessionSecret: "planning-integration-secret-planning",
          loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
        },
      },
    );
    await app.ready();
    nimal = await signIn({
      role: "DISPATCHER",
      email: DISPATCHER_LOGIN_ID,
      password: DEMO_PASSWORD,
      depot: "Peliyagoda",
    });
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  it("shows the day: state from the cutoff, the confirmed queue, and demand beyond capacity", async () => {
    const res = await call(nimal, "GET", peliyagoda());
    expect(res.statusCode, res.body).toBe(200);
    const day = res.json() as ApiDto<"dayResponse">;
    expect(day).toMatchObject({ date: DATE, depot: "Peliyagoda", state: "CLOSED", currentVersion: null });
    expect(day.queue).toHaveLength(86);
    expect(day.planningContext.vehicleFuel).toHaveLength(38);
    expect(day.planningContext.outletService).toHaveLength(new Set(day.queue.map((order) => order.outletId)).size);
    expect(day.planningContext.loadedOrders).toEqual([]);
    expect(day.queue.filter((o) => o.status === "DEFERRED").length).toBeGreaterThan(0);
    expect(day.demandCapacity.orders).toBe(86);
    expect(day.demandCapacity.deferred).toBeGreaterThan(0);
    expect(day.demandCapacity.vehiclesAvailable).toBe(38 - PEAK_DAY_WORKSHOP.length);
  });

  it("has no draft before the first proposal", async () => {
    expect((await call(nimal, "GET", peliyagoda("/draft"))).json()).toEqual({ draft: null });
  });

  let proposed: ApiDto<"draft">;

  it("proposes a plan that passes validatePlan and explains every unassigned order", async () => {
    const res = await call(nimal, "POST", peliyagoda("/propose"), { revision: 0 });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ApiDto<"proposeResponse">;
    proposed = body.draft;
    expect(proposed.revision).toBe(1);
    expect(body.stats.deferred).toBeGreaterThan(0);
    expect(body.trace.length).toBeGreaterThan(0);

    const assigned = proposed.data.trips.flatMap((t) => t.orderIds);
    expect(assigned.length + proposed.data.unassignedOrderIds.length).toBe(86);
    const explained = new Map(proposed.data.deferrals.map((d) => [d.orderId, d.reasonCode]));
    for (const id of proposed.data.unassignedOrderIds) expect(explained.get(id)).toBeTruthy();

    const workshop = await database.prisma!.vehicle.findMany({
      where: { displayId: { in: PEAK_DAY_WORKSHOP.map((w) => w.vehicleId) } },
    });
    const used = new Set(proposed.data.trips.map((t) => t.vehicleId));
    for (const v of workshop) expect(used.has(v.id)).toBe(false);

    const validation = await call(nimal, "POST", peliyagoda("/validate"), { data: proposed.data });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({ ok: true });
    expect((await database.prisma!.planningDay.findFirstOrThrow({ where: { depot: "Peliyagoda" } })).state).toBe(
      "PLANNING",
    );
  });

  it("uses the revision for optimistic concurrency", async () => {
    const stale = await call(nimal, "POST", peliyagoda("/propose"), { revision: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "REVISION_CONFLICT", params: { revision: 1 } });
    const save = await call(nimal, "PUT", peliyagoda("/draft"), { revision: 0, data: proposed.data });
    expect(save.statusCode).toBe(409);
    const again = await call(nimal, "POST", peliyagoda("/propose"), { revision: 1 });
    expect(again.statusCode).toBe(200);
    proposed = (again.json() as ApiDto<"proposeResponse">).draft;
    expect(proposed.revision).toBe(2);
  });

  it("re-validates on save: a hard violation is 422, a valid edit saves", async () => {
    const prisma = database.prisma!;
    const chilled = await prisma.order.findFirstOrThrow({
      where: { id: { in: proposed.data.trips.flatMap((t) => t.orderIds) }, tempRequirement: "chilled" },
    });
    const ambient = await prisma.vehicle.findFirstOrThrow({
      where: {
        depot: "Peliyagoda",
        temp: "ambient",
        type: "truck",
        id: { notIn: proposed.data.trips.map((t) => t.vehicleId) },
      },
    });
    const without = proposed.data.trips
      .map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => id !== chilled.id) }))
      .filter((t) => t.orderIds.length > 0);
    const broken = {
      ...proposed.data,
      trips: [...without, { ref: "T999", vehicleId: ambient.id, tripNo: 1 as const, orderIds: [chilled.id] }],
    };
    const refused = await call(nimal, "PUT", peliyagoda("/draft"), { revision: 2, data: broken });
    expect(refused.statusCode).toBe(422);
    const error = refused.json();
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.validation.violations.map((v: { code: string }) => v.code)).toContain("REEFER_REQUIRED");

    const deferred = {
      ...proposed.data,
      trips: without,
      unassignedOrderIds: [...proposed.data.unassignedOrderIds, chilled.id],
      deferrals: [...proposed.data.deferrals, { orderId: chilled.id, reasonCode: "OTHER" as const, note: "held back" }],
    };
    const saved = await call(nimal, "PUT", peliyagoda("/draft"), { revision: 2, data: deferred });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().draft.revision).toBe(3);
    expect((await call(nimal, "GET", peliyagoda("/draft"))).json().draft.data).toEqual(deferred);
  });

  it("supports manual planning from an empty draft", async () => {
    const kandy = `/api/dispatch/days/${DATE}/draft?depot=Kandy`;
    const empty = { trips: [], unassignedOrderIds: [], deferrals: [] };
    const res = await call(nimal, "PUT", kandy, { revision: 0, data: empty });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().draft).toMatchObject({ revision: 1, baseVersion: null, data: empty });
  });

  it("refuses drafts while orders are still open", async () => {
    const res = await call(nimal, "POST", "/api/dispatch/days/2027-03-02/propose?depot=Peliyagoda", { revision: 0 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "ILLEGAL_TRANSITION", params: { state: "OPEN" } });
  });

  it("is scoped to the dispatcher's depots and role", async () => {
    await database.prisma!.user.create({
      data: {
        loginId: "kandy.dispatch@waypoint.test",
        role: "DISPATCHER",
        displayName: "Kandy dispatcher",
        depot: "Kandy",
        passwordHash: await hashSecret(DEMO_PASSWORD),
      },
    });
    const kandyOnly = await signIn({
      role: "DISPATCHER",
      email: "kandy.dispatch@waypoint.test",
      password: DEMO_PASSWORD,
      depot: "Kandy",
    });
    expect((await call(kandyOnly, "GET", peliyagoda())).statusCode).toBe(403);
    expect((await call(kandyOnly, "GET", `${PELIYAGODA}?depot=Kandy`)).statusCode).toBe(200);
    const fleet = (await call(kandyOnly, "GET", `/api/dispatch/fleet?date=${DATE}`)).json() as ApiDto<"fleetResponse">;
    expect(new Set(fleet.items.map((i) => i.vehicle.depot))).toEqual(new Set(["Kandy"]));

    const store = await signIn({ role: "STORE", loginId: "OUT004", password: DEMO_PASSWORD });
    expect((await call(store, "GET", peliyagoda())).statusCode).toBe(403);
  });

  it("lists the fleet with the day's workshop vehicles", async () => {
    const res = await call(nimal, "GET", `/api/dispatch/fleet?date=${DATE}`);
    expect(res.statusCode, res.body).toBe(200);
    const fleet = res.json() as ApiDto<"fleetResponse">;
    expect(fleet.items).toHaveLength(60);
    const workshop = fleet.items.filter((i) => i.availability.status === "IN_WORKSHOP");
    expect(workshop.map((i) => i.vehicle.displayId).sort()).toEqual(
      [...PEAK_DAY_WORKSHOP, ...HILL_RUN_WORKSHOP].map((w) => w.vehicleId).sort(),
    );
    const veh039 = fleet.items.find((i) => i.vehicle.displayId === "VEH039")!;
    expect(veh039.vehicle.driver.name).toBe("Sampath");
    expect(veh039.availability).toEqual({ status: "AVAILABLE", reason: null, note: null, changedAt: null });
  });

  it("counts fuel from other published days of the ISO week only", async () => {
    const prisma = database.prisma!;
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { displayId: "VEH002" } });
    const district = await prisma.district.findUniqueOrThrow({ where: { name: "Colombo" } });
    const day = await prisma.planningDay.create({
      data: { depot: "Peliyagoda", date: new Date("2026-09-28T00:00:00.000Z"), state: "PUBLISHED", currentVersion: 1 },
    });
    await prisma.trip.create({
      data: {
        displayId: "T-FUEL-1",
        tripNo: 1,
        brand: "Fresh",
        plannedDepart: 210,
        plannedMinutes: 100,
        km: "20",
        litres: "4.5",
        planningDayId: day.id,
        vehicleId: vehicle.id,
        districtId: district.id,
      },
    });
    expect((await fuelUsedThisWeek(prisma, DATE)).get(vehicle.id)).toBe(4500);
    expect((await fuelUsedThisWeek(prisma, "2026-09-28")).get(vehicle.id)).toBeUndefined();
    expect((await fuelUsedThisWeek(prisma, "2026-10-05")).get(vehicle.id)).toBeUndefined();
  });
});
