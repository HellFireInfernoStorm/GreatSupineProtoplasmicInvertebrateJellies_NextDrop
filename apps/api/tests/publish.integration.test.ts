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
  it("edits departed later stops, protects reported facts and holds offline cancelled-stop delivery (ADR 0053)", async () => {
    const prisma = database.prisma!;
    const deviceId = randomUUID();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "DRIVER", loginId: WALKTHROUGH_DRIVER_ID, pin: DEMO_PIN, deviceId },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(login.statusCode, login.body).toBe(200);
    const userId = login.json().user.id as string;
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const headers = { [CSRF_HEADER]: login.json().csrfToken as string };
    const versions = (await call("GET", day("/versions", "Kandy"))).json() as ApiDto<"versionsResponse">;
    const plan = versions.items.at(-1)!;
    const hill =
      plan.trips.find((t) => t.vehicleId === login.json().user.vehicleId) ??
      plan.trips.find((t) => t.stops.length >= 4)!;
    let seq = 0;
    const event = (type: string, orderId: string | null, payload: object) => ({
      clientEventId: randomUUID(),
      deviceId,
      deviceSeq: seq++,
      schemaVersion: 1,
      source: "FIELD",
      actor: { userId, role: "DRIVER" },
      subject: { tripId: hill.id, ...(orderId ? { orderId } : {}) },
      capturedAt: `${DATE}T01:00:00.000Z`,
      basedOnPlanVersion: plan.version,
      type,
      payload,
    });
    const push = async (events: unknown[]) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/sync/events",
        cookies,
        headers,
        payload: { deviceId, events },
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json().results as { status: string; conflictId?: string }[];
    };
    // The walkthrough loads on the dock, then departs. Departure itself is the real ingest path.
    await prisma.trip.update({ where: { id: hill.id }, data: { status: "READY" } });
    expect((await push([event("TRIP_DEPARTED", null, { tripId: hill.id })]))[0]?.status).toBe("ACCEPTED");
    const reported = hill.stops[0]!.order.id;
    expect((await push([event("STOP_OUTCOME", reported, { outcome: "FULL" })]))[0]?.status).toBe("ACCEPTED");
    const offline = hill.stops.at(-1)!.order.id;
    const offlineFact = event("STOP_OUTCOME", offline, { outcome: "FULL" });
    const beforeDay = (await call("GET", day("", "Kandy"))).json() as ApiDto<"dayResponse">;
    expect(beforeDay.queue.map((o) => o.id)).toEqual(expect.arrayContaining(hill.stops.map((s) => s.order.id)));
    expect(beforeDay.planningContext.publishedStops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: reported, locked: true, departed: true }),
        expect.objectContaining({ orderId: offline, locked: false, departed: true }),
      ]),
    );
    const current = (await call("GET", day("/draft", "Kandy"))).json().draft as ApiDto<"draft">;
    const target = current.data.trips.find((t) => t.orderIds.includes(offline))!;
    const edited: DraftData = {
      ...current.data,
      trips: current.data.trips.map((t) =>
        t.ref === target.ref
          ? {
              ...t,
              orderIds: [
                t.orderIds[0]!,
                ...t.orderIds
                  .slice(1)
                  .filter((id) => id !== offline)
                  .reverse(),
              ],
            }
          : t,
      ),
      unassignedOrderIds: [offline],
      deferrals: [{ orderId: offline, reasonCode: "OTHER", note: "Offline stop cancelled" }],
    };
    const saved = await saveDraft(current.revision, edited, "Kandy");
    const published = await call("POST", day("/publish", "Kandy"), { revision: saved.revision });
    expect(published.statusCode, published.body).toBe(200);
    expect(
      await prisma.orderEvent.count({
        where: { type: "PLAN_CHANGED", orderId: { in: target.orderIds.slice(1).filter((id) => id !== offline) } },
      }),
    ).toBeGreaterThan(0);
    const retained = await prisma.order.findMany({
      where: { id: { in: target.orderIds.filter((id) => id !== offline) } },
    });
    expect(retained.find((o) => o.id === reported)?.status).toBe("DELIVERED");
    expect(retained.filter((o) => o.id !== reported).every((o) => o.status === "OUT_FOR_DELIVERY")).toBe(true);
    const replay = await prisma.order.findUniqueOrThrow({
      where: { id: offline },
      include: { orderEvent_orderId: { orderBy: { id: "asc" } } },
    });
    expect(reduceOrder(offline, replay.orderEvent_orderId.map(toRulesEvent)).status).toBe(replay.status);
    const held = (await push([offlineFact]))[0]!;
    expect(held.status).toBe("HELD_CONFLICT");
    expect(await prisma.conflict.findUniqueOrThrow({ where: { id: held.conflictId! } })).toMatchObject({
      kind: "FACT_ON_CANCELLED_STOP",
    });
    // Simulate a stale/tampered draft to ensure authoritative publish refuses moving a reported stop atomically.
    const illegal = {
      ...edited,
      trips: edited.trips.map((t) =>
        t.ref === target.ref ? { ...t, orderIds: [...t.orderIds.slice(1), reported] } : t,
      ),
    };
    await prisma.planDraft.update({
      where: {
        planningDayId: (await prisma.planningDay.findFirstOrThrow({ where: { depot: "Kandy", date: new Date(DATE) } }))
          .id,
      },
      data: { revision: saved.revision + 1, data: illegal },
    });
    const before = await written();
    const refused = await call("POST", day("/publish", "Kandy"), { revision: saved.revision + 1 });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "STOP_LOCKED", params: { orderId: reported } });
    expect(await written()).toEqual(before);
  }, 60000);
  it("defers a planned stop before loaded cargo and still refuses moving the loaded order", async () => {
    const prisma = database.prisma!;
    const date = "2026-10-01";
    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { displayId: "OUT004" } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { displayId: "VEH001" } });
    const product = await prisma.product.findFirstOrThrow({
      where: { brand: outlet.brand, tempRequirement: "ambient" },
    });
    const planningDay = await prisma.planningDay.create({
      data: { depot: "Peliyagoda", date: new Date(date), state: "CLOSED" },
    });
    const orders = await Promise.all(
      ["EARLIER", "LOADED"].map((name) =>
        prisma.order.create({
          data: {
            displayId: `ORD159-${name}`,
            brand: outlet.brand,
            tempRequirement: "ambient",
            requestedDate: new Date(date),
            currentDate: new Date(date),
            weightG: 1000,
            volumeL: 1,
            idempotencyKey: randomUUID(),
            outletId: outlet.id,
            orderLine_orderId: {
              create: {
                productId: product.id,
                qtyOrdered: 1,
                unitWeightKg: product.unitWeightKg,
                unitVolumeM3: product.unitVolumeM3,
              },
            },
          },
        }),
      ),
    );
    const earlier = orders[0]!.id;
    const loaded = orders[1]!.id;
    const data: DraftData = {
      trips: [{ ref: "T159", vehicleId: vehicle.id, tripNo: 1, orderIds: [earlier, loaded] }],
      unassignedOrderIds: [],
      deferrals: [],
    };
    let saved = await saveDraft(0, data, "Peliyagoda", date);
    const first = await call("POST", day("/publish", "Peliyagoda", date), { revision: saved.revision });
    expect(first.statusCode, first.body).toBe(200);
    await prisma.order.update({ where: { id: loaded }, data: { status: "LOADED" } });
    const edited: DraftData = {
      trips: [{ ...data.trips[0]!, orderIds: [loaded] }],
      unassignedOrderIds: [earlier],
      deferrals: [{ orderId: earlier, reasonCode: "OTHER", note: "Skipped before loading completes" }],
    };
    saved = await saveDraft(saved.revision, edited, "Peliyagoda", date);
    const published = await call("POST", day("/publish", "Peliyagoda", date), { revision: saved.revision });
    expect(published.statusCode, published.body).toBe(200);
    expect(await prisma.tripStop.findFirstOrThrow({ where: { orderId: loaded } })).toMatchObject({ seq: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: loaded } })).status).toBe("LOADED");
    // Simulate a stale draft so publish, rather than only save validation, must enforce the pin.
    await prisma.planDraft.update({
      where: { planningDayId: planningDay.id },
      data: {
        revision: saved.revision + 1,
        data: { ...edited, unassignedOrderIds: [], deferrals: [], trips: [{ ...edited.trips[0]!, tripNo: 2 }] },
      },
    });
    const before = await written();
    const refused = await call("POST", day("/publish", "Peliyagoda", date), { revision: saved.revision + 1 });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().validation.violations).toContainEqual(
      expect.objectContaining({ code: "ORDER_ALREADY_LOADED", orderIds: [loaded] }),
    );
    expect(await written()).toEqual(before);
  }, 60000);
  it("removes the skipped first stop when the second departed stop has a reported fact", async () => {
    const prisma = database.prisma!;
    const date = "2026-10-03";
    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { displayId: "OUT004" } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { displayId: "VEH001" } });
    const product = await prisma.product.findFirstOrThrow({
      where: { brand: outlet.brand, tempRequirement: "ambient" },
    });
    const driver = await prisma.user.findUniqueOrThrow({ where: { loginId: "DRV001" } });
    await prisma.planningDay.create({ data: { depot: "Peliyagoda", date: new Date(date), state: "CLOSED" } });
    const orders = await Promise.all(
      ["SKIPPED", "REPORTED"].map((name) =>
        prisma.order.create({
          data: {
            displayId: `ORD159-${name}`,
            brand: outlet.brand,
            tempRequirement: "ambient",
            requestedDate: new Date(date),
            currentDate: new Date(date),
            weightG: 1000,
            volumeL: 1,
            idempotencyKey: randomUUID(),
            outletId: outlet.id,
            orderLine_orderId: {
              create: {
                productId: product.id,
                qtyOrdered: 1,
                unitWeightKg: product.unitWeightKg,
                unitVolumeM3: product.unitVolumeM3,
              },
            },
          },
        }),
      ),
    );
    const skipped = orders[0]!.id;
    const reported = orders[1]!.id;
    const data: DraftData = {
      trips: [{ ref: "T159", vehicleId: vehicle.id, tripNo: 1, orderIds: [skipped, reported] }],
      unassignedOrderIds: [],
      deferrals: [],
    };
    let saved = await saveDraft(0, data, "Peliyagoda", date);
    const first = await call("POST", day("/publish", "Peliyagoda", date), { revision: saved.revision });
    expect(first.statusCode, first.body).toBe(200);
    const trip = (first.json() as ApiDto<"publishResponse">).plan.trips[0]!;
    await prisma.trip.update({ where: { id: trip.id }, data: { status: "DEPARTED" } });
    await prisma.order.updateMany({ where: { id: { in: [skipped, reported] } }, data: { status: "OUT_FOR_DELIVERY" } });
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
        capturedAt: new Date(`${date}T01:00:00Z`),
        orderId: reported,
        tripId: trip.id,
        payload: { orderId: reported },
      },
    });
    saved = await saveDraft(
      saved.revision,
      {
        trips: [{ ...data.trips[0]!, orderIds: [reported] }],
        unassignedOrderIds: [skipped],
        deferrals: [{ orderId: skipped, reasonCode: "OTHER", note: "Driver skipped the first stop" }],
      },
      "Peliyagoda",
      date,
    );
    const published = await call("POST", day("/publish", "Peliyagoda", date), { revision: saved.revision });
    expect(published.statusCode, published.body).toBe(200);
    expect(await prisma.tripStop.findFirstOrThrow({ where: { orderId: reported } })).toMatchObject({
      seq: 1,
      tripId: trip.id,
    });
    expect(await prisma.tripStop.count({ where: { orderId: skipped } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: skipped } })).status).toBe("DEFERRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: reported } })).status).toBe("OUT_FOR_DELIVERY");
  }, 60000);
});
