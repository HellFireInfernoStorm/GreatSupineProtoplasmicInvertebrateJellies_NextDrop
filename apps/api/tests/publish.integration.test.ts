// The publish transaction against the seeded peak day in PostgreSQL (issue #48).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ApiDto } from "@nextdrop/contracts";
import { reduceOrder, type OrderEvent } from "@nextdrop/rules";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DEMO_PIN, DISPATCHER_LOGIN_ID } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import { WALKTHROUGH_DRIVER_ID, WALKTHROUGH_TRIP, WALKTHROUGH_VEHICLE_ID } from "../prisma/seed/story-fixtures";
import { createDatabase, type Database } from "../src/lib/database";
import { CSRF_HEADER, SESSION_COOKIE } from "../src/modules/auth";
import { toRulesEvent } from "../src/modules/orders";
import { buildServer, type App } from "../src/server";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test.");
}
const schema = `issue48_${randomUUID().replaceAll("-", "")}`;
const suiteUrl = url ? new URL(url) : undefined;
suiteUrl?.searchParams.set("schema", schema);
const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
const DATE = "2026-09-29";
const day = (path: string, depot = "Peliyagoda", date = DATE) => `/api/dispatch/days/${date}${path}?depot=${depot}`;
let database: Database;
let app: App;
let session: { cookies: Record<string, string>; csrf: string };
type DraftData = ApiDto<"draftData">;

function call(method: "GET" | "POST" | "PUT", path: string, payload?: object): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: path,
    cookies: session.cookies,
    headers: method === "GET" ? {} : { [CSRF_HEADER]: session.csrf },
    ...(payload ? { payload } : {}),
  });
}

/** Rows that publishing writes, so "writes nothing" can be checked. */
async function written() {
  const p = database.prisma!;
  return {
    versions: await p.planVersion.count(),
    trips: await p.trip.count(),
    stops: await p.tripStop.count(),
    deferrals: await p.deferral.count(),
    events: await p.orderEvent.count(),
    notifications: await p.notification.count(),
    feed: await p.changeFeed.count(),
  };
}

async function saveDraft(revision: number, data: DraftData, depot = "Peliyagoda", date = DATE) {
  const res = await call("PUT", day("/draft", depot, date), { revision, data });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as ApiDto<"draftResponse">).draft!;
}

/** Every deferral with a reason and a note, so repeat deferrals pass. */
const withNotes = (data: DraftData): DraftData => ({
  ...data,
  deferrals: data.deferrals.map((d) => ({ ...d, reasonCode: d.reasonCode ?? "OTHER", note: "Reviewed in the test" })),
});

describe.skipIf(!url)("publish transaction (PostgreSQL)", () => {
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
          sessionSecret: "publish-integration-secret-publish-int",
          loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
        },
      },
    );
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "DISPATCHER", email: DISPATCHER_LOGIN_ID, password: DEMO_PASSWORD, depot: "Peliyagoda" },
      headers: { [CSRF_HEADER]: "1" },
    });
    session = {
      cookies: { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value },
      csrf: res.json().csrfToken as string,
    };
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

  let draft: ApiDto<"draft">;

  it("writes nothing when the plan breaks a hard rule at publish time", async () => {
    const proposed = await call("POST", day("/propose"), { revision: 0 });
    expect(proposed.statusCode, proposed.body).toBe(200);
    draft = (proposed.json() as ApiDto<"proposeResponse">).draft;
    draft = await saveDraft(draft.revision, withNotes(draft.data));

    // A vehicle on the plan goes to the workshop after the draft was saved.
    const prisma = database.prisma!;
    const vehicleId = draft.data.trips[0]!.vehicleId;
    const nimal = await prisma.user.findUniqueOrThrow({ where: { loginId: DISPATCHER_LOGIN_ID } });
    const workshop = await prisma.vehicleAvailability.create({
      data: {
        vehicleId,
        date: new Date(`${DATE}T00:00:00.000Z`),
        status: "IN_WORKSHOP",
        reason: "SERVICE",
        setBy: nimal.id,
      },
    });
    const before = await written();
    const res = await call("POST", day("/publish"), { revision: draft.revision });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.json().validation.violations.map((v: { code: string }) => v.code)).toContain("VEHICLE_UNAVAILABLE");
    expect(await written()).toEqual(before);
    await prisma.vehicleAvailability.delete({ where: { id: workshop.id } });
  });

  it("refuses an unassigned order without a reason", async () => {
    const order = draft.data.unassignedOrderIds[0]!;
    const missing = { ...draft.data, deferrals: draft.data.deferrals.filter((d) => d.orderId !== order) };
    draft = await saveDraft(draft.revision, missing);
    const before = await written();
    const res = await call("POST", day("/publish"), { revision: draft.revision });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "MISSING_DEFERRAL_REASON", params: { orders: 1 } });
    expect(res.json().validation).toBeTruthy();
    expect(await written()).toEqual(before);
    draft = await saveDraft(
      draft.revision,
      withNotes({ ...missing, deferrals: [...missing.deferrals, { orderId: order }] }),
    );
  });

  let published: ApiDto<"planVersion">;

  it("publishes version 1: trips, stops, events, deferrals, rollover, notifications and feed", async () => {
    const res = await call("POST", day("/publish"), { revision: draft.revision });
    expect(res.statusCode, res.body).toBe(200);
    published = (res.json() as ApiDto<"publishResponse">).plan;
    const served = draft.data.trips.flatMap((t) => t.orderIds);
    const deferred = draft.data.unassignedOrderIds;
    expect(published).toMatchObject({ version: 1, summary: { served: served.length, deferred: deferred.length } });
    expect(published.trips.flatMap((t) => t.stops)).toHaveLength(served.length);
    expect(published.deferrals.map((d) => d.orderId).sort()).toEqual([...deferred].sort());
    for (const d of published.deferrals) expect(d.nextServiceableDate).toBe("2026-09-30");

    const prisma = database.prisma!;
    const dayRow = await prisma.planningDay.findFirstOrThrow({
      where: { depot: "Peliyagoda", date: new Date(`${DATE}T00:00:00.000Z`) },
    });
    expect(dayRow).toMatchObject({ state: "PUBLISHED", currentVersion: 1 });
    expect(await prisma.trip.count({ where: { planningDayId: dayRow.id } })).toBe(draft.data.trips.length);
    expect(await prisma.deferral.count()).toBe(deferred.length);

    const orders = await prisma.order.findMany({
      where: { id: { in: [...served, ...deferred] } },
      include: { orderEvent_orderId: { orderBy: { id: "asc" } } },
    });
    for (const o of orders) {
      const reduced = reduceOrder(o.id, o.orderEvent_orderId.map(toRulesEvent) as OrderEvent[]);
      expect(reduced.status, o.displayId).toBe(o.status);
      if (served.includes(o.id)) {
        expect(o.status).toBe("PLANNED");
        expect(reduced.assignment?.tripId).toBeTruthy();
      } else {
        expect(o.status).toBe("DEFERRED");
        expect(o.currentDate.toISOString().slice(0, 10)).toBe("2026-09-30");
      }
    }

    const kinds = (await prisma.notification.findMany({ select: { kind: true } })).map((n) => n.kind);
    expect(kinds).toContain("plan_changed");
    expect(await prisma.changeFeed.count({ where: { kind: "plan_published" } })).toBeGreaterThan(0);
    const changes = await prisma.planVersionChange.findMany({ where: { planVersion: { version: 1 } } });
    expect(changes).toHaveLength(served.length + deferred.length);
  }, 60000);

  it("is idempotent per draft revision", async () => {
    const before = await written();
    const again = await call("POST", day("/publish"), { revision: draft.revision });
    expect(again.statusCode).toBe(200);
    expect((again.json() as ApiDto<"publishResponse">).plan.version).toBe(1);
    expect(await written()).toEqual(before);
    const versions = (await call("GET", day("/versions"))).json() as ApiDto<"versionsResponse">;
    expect(versions.items.map((v) => v.version)).toEqual([1]);
  });

  it("republishes with change rows for what moved", async () => {
    const current = (await call("GET", day("/draft"))).json().draft as ApiDto<"draft">;
    const trip = current.data.trips.find((t) => t.orderIds.length > 1)!;
    const dropped = trip.orderIds[0]!;
    const edited: DraftData = {
      trips: current.data.trips.map((t) => (t === trip ? { ...t, orderIds: t.orderIds.slice(1) } : t)),
      unassignedOrderIds: [...current.data.unassignedOrderIds, dropped],
      deferrals: [...current.data.deferrals, { orderId: dropped, reasonCode: "OTHER", note: "Store asked to skip" }],
    };
    // Already-deferred orders rolled to 30 Sep and are no longer in this day's queue.
    const stillQueued = new Set(((await call("GET", day(""))).json() as ApiDto<"dayResponse">).queue.map((o) => o.id));
    edited.unassignedOrderIds = edited.unassignedOrderIds.filter((id) => stillQueued.has(id));
    edited.deferrals = edited.deferrals.filter((d) => stillQueued.has(d.orderId));
    draft = await saveDraft(current.revision, edited);
    const res = await call("POST", day("/publish"), { revision: draft.revision });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ApiDto<"publishResponse">).plan.version).toBe(2);
    const changes = await database.prisma!.planVersionChange.findMany({ where: { planVersion: { version: 2 } } });
    expect(changes).toContainEqual(expect.objectContaining({ orderId: dropped, change: "DEFERRED" }));
    expect(changes.length).toBeLessThan(published.summary.served);
  }, 60000);

  it("locks a stop the driver has reached", async () => {
    const prisma = database.prisma!;
    const current = (await call("GET", day("/draft"))).json().draft as ApiDto<"draft">;
    const trip = current.data.trips.find((t) => t.orderIds.length > 1)!;
    const reached = trip.orderIds[0]!;
    const driver = await prisma.user.findUniqueOrThrow({ where: { loginId: "DRV001" } });
    const device = await prisma.device.create({
      data: { id: randomUUID(), kind: "FIELD", appVersion: "test", lastSeenAt: new Date(), userId: driver.id },
    });
    await prisma.orderEvent.create({
      data: {
        type: "STOP_ARRIVED",
        source: "FIELD",
        clientEventId: randomUUID(),
        deviceId: device.id,
        deviceSeq: 0,
        actorRole: "DRIVER",
        actorUserId: driver.id,
        capturedAt: new Date(),
        payload: { orderId: reached },
        orderId: reached,
      },
    });
    const edited: DraftData = {
      ...current.data,
      trips: current.data.trips.map((t) => (t === trip ? { ...t, orderIds: t.orderIds.slice(1) } : t)),
      unassignedOrderIds: [...current.data.unassignedOrderIds, reached],
      deferrals: [...current.data.deferrals, { orderId: reached, reasonCode: "OTHER", note: "Try to drop it" }],
    };
    draft = await saveDraft(current.revision, edited);
    const before = await written();
    const res = await call("POST", day("/publish"), { revision: draft.revision });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "STOP_LOCKED", params: { orderId: reached } });
    expect(await written()).toEqual(before);
  }, 60000);

  it("serialises publishes that share the depot's ISO week", async () => {
    const empty: DraftData = { trips: [], unassignedOrderIds: [], deferrals: [] };
    const kandyMonday = await saveDraft(0, empty, "Kandy", "2026-09-28");
    // Hold the (Kandy, 2026-W40) publish lock from another connection.
    const holder = await admin.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["publish:Kandy:2026-40"]);
      let done = false;
      const publishing = call("POST", day("/publish", "Kandy", "2026-09-28"), { revision: kandyMonday.revision }).then(
        (r) => {
          done = true;
          return r;
        },
      );
      await new Promise((r) => setTimeout(r, 1500));
      expect(done).toBe(false);
      await holder.query("COMMIT");
      const res = await publishing;
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      holder.release();
    }
  }, 60000);

  it("puts the Kandy hill trip on the walkthrough vehicle, where its driver sees it (ADR 0048)", async () => {
    const proposed = await call("POST", day("/propose", "Kandy"), { revision: 0 });
    expect(proposed.statusCode, proposed.body).toBe(200);
    const kandy = (proposed.json() as ApiDto<"proposeResponse">).draft;
    expect(kandy.data.unassignedOrderIds).toEqual([]);
    const published = await call("POST", day("/publish", "Kandy"), { revision: kandy.revision });
    expect(published.statusCode, published.body).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "DRIVER", loginId: WALKTHROUGH_DRIVER_ID, pin: DEMO_PIN, deviceId: randomUUID() },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(login.statusCode, login.body).toBe(200);
    const snapshot = await app.inject({
      method: "GET",
      url: `/api/field/snapshot?date=${DATE}`,
      cookies: { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value },
    });
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    const scope = snapshot.json().scope as { vehicle: { displayId: string }; trips: ApiDto<"trip">[] };
    expect(scope.vehicle.displayId).toBe(WALKTHROUGH_VEHICLE_ID);
    const hill = scope.trips.find((t) => t.tripNo === WALKTHROUGH_TRIP.tripNo)!;
    expect(hill).toMatchObject({ brand: WALKTHROUGH_TRIP.brand, district: WALKTHROUGH_TRIP.district });
    expect([...new Set(hill.stops.map((s) => s.outlet.displayId))]).toEqual([...WALKTHROUGH_TRIP.stopOutletIds]);
  }, 60000);
});
