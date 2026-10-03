// Server clock, planning-day tick and the before-cutoff reset against PostgreSQL (issue #38).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEMO_SCRIPT_KEY_HEADER } from "@nextdrop/contracts";
import { cutoffAt } from "@nextdrop/rules";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DEMO_PIN, DISPATCHER_LOGIN_ID } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import { createDatabase, type Database } from "../src/lib/database";
import { CSRF_HEADER, SESSION_COOKIE } from "../src/modules/auth";
import { BEFORE_CUTOFF_TIME } from "../src/modules/demo";
import { startJobs, TICK_QUEUE } from "../src/modules/jobs";
import { buildServer, type App } from "../src/server";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test.");
}
const schema = `issue38_${randomUUID().replaceAll("-", "")}`;
const suiteUrl = url ? new URL(url) : undefined;
suiteUrl?.searchParams.set("schema", schema);
const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
const SCRIPT_KEY = "integration-script-key";
const auth = {
  sessionSecret: "demo-integration-secret-demo-integration",
  demoMode: true,
  demoScriptKey: SCRIPT_KEY,
  loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
};
let database: Database;
let app: App;
let dispatcher: { cookies: Record<string, string>; csrf: string };

async function signIn(payload: object) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload,
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
  return { cookies: { [SESSION_COOKIE]: cookie.value }, csrf: res.json().csrfToken as string };
}

function asDispatcher(method: "GET" | "POST", path: string, payload?: object): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: path,
    cookies: dispatcher.cookies,
    headers: method === "POST" ? { [CSRF_HEADER]: dispatcher.csrf } : {},
    ...(payload ? { payload } : {}),
  });
}

/** What a judge would see: everything except generated IDs and the exact reset instant. */
async function storyState() {
  const prisma = database.prisma!;
  const orders = await prisma.order.findMany({
    orderBy: { displayId: "asc" },
    include: {
      outlet: { select: { displayId: true } },
      orderLine_orderId: { select: { qtyOrdered: true, product: { select: { sku: true } } } },
      orderEvent_orderId: { select: { type: true, capturedAt: true, payload: true }, orderBy: { id: "asc" } },
    },
  });
  const days = await prisma.planningDay.findMany({ orderBy: [{ depot: "asc" }, { date: "asc" }] });
  const availability = await prisma.vehicleAvailability.findMany({
    include: { vehicle: { select: { displayId: true } } },
    orderBy: { vehicleId: "asc" },
  });
  const service = await prisma.outletServiceState.findMany({
    include: { outlet: { select: { displayId: true } } },
    orderBy: { outletId: "asc" },
  });
  const demo = await prisma.demoState.findUniqueOrThrow({ where: { singleton: true } });
  return {
    orders: orders.map((o) => ({
      id: o.displayId,
      outlet: o.outlet.displayId,
      status: o.status,
      currentDate: o.currentDate,
      weightG: o.weightG,
      lines: o.orderLine_orderId.map((l) => [l.product.sku, l.qtyOrdered]).sort(),
      events: o.orderEvent_orderId.map((e) => [e.type, e.capturedAt.toISOString()]),
    })),
    days: days.map((d) => [d.depot, d.date.toISOString(), d.state, d.ordersClosedAt]),
    availability: availability.map((a) => [a.vehicle.displayId, a.status, a.reason]),
    service: service.map((s) => [s.outlet.displayId, s.lastServedDate?.toISOString() ?? null, s.deferredLastRun]),
    demo: { preset: demo.preset, lastResetBy: demo.lastResetBy },
    notifications: await prisma.notification.count(),
    conflicts: await prisma.conflict.count(),
  };
}

describe.skipIf(!url)("demo module (PostgreSQL)", () => {
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
    app = await buildServer({}, { database: { ...database, close: async () => {} }, auth });
    await app.ready();
    dispatcher = await signIn({
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

  describe("access", () => {
    it("lets a dispatcher or the script key in, and refuses other roles and anonymous callers", async () => {
      expect((await asDispatcher("GET", "/api/demo/state")).statusCode).toBe(200);
      const byKey = await app.inject({
        method: "GET",
        url: "/api/demo/state",
        headers: { [DEMO_SCRIPT_KEY_HEADER]: SCRIPT_KEY },
      });
      expect(byKey.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/demo/state" })).statusCode).toBe(401);
      const loader = await signIn({
        role: "LOADER",
        loginId: "LDR001",
        pin: DEMO_PIN,
        deviceId: "0190a000-0000-7000-8000-000000000001",
      });
      const res = await app.inject({ method: "GET", url: "/api/demo/state", cookies: loader.cookies });
      expect(res.statusCode).toBe(403);
    });

    it("needs the CSRF header on mutations", async () => {
      const res = await app.inject({ method: "POST", url: "/api/demo/tick", cookies: dispatcher.cookies });
      expect(res.statusCode).toBe(403);
    });

    it("does not exist without DEMO_MODE", async () => {
      const off = await buildServer(
        {},
        { database: { ...database, close: async () => {} }, auth: { ...auth, demoMode: false } },
      );
      try {
        const res = await off.inject({
          method: "GET",
          url: "/api/demo/state",
          headers: { [DEMO_SCRIPT_KEY_HEADER]: SCRIPT_KEY },
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await off.close();
      }
    });

    it("rate-limits the clock", async () => {
      const limited = await buildServer(
        {},
        { database: { ...database, close: async () => {} }, auth, demoRateLimit: { max: 1, timeWindowMs: 60_000 } },
      );
      try {
        const move = () =>
          limited.inject({
            method: "POST",
            url: "/api/demo/clock",
            headers: { [DEMO_SCRIPT_KEY_HEADER]: SCRIPT_KEY, [CSRF_HEADER]: "1" },
            payload: { serverTime: BEFORE_CUTOFF_TIME.toISOString() },
          });
        expect((await move()).statusCode).toBe(200);
        expect((await move()).statusCode).toBe(429);
      } finally {
        await limited.close();
      }
    });
  });

  describe("reset to before-cutoff", () => {
    it("restores the story day at Mon 28 Sep 14:00 and records who reset it", async () => {
      const before = (await asDispatcher("GET", "/api/demo/state")).json();
      const res = await asDispatcher("POST", "/api/demo/reset", { preset: "before-cutoff" });
      expect(res.statusCode, res.body).toBe(200);
      const state = res.json();
      expect(state).toMatchObject({ enabled: true, preset: "before-cutoff", lastResetBy: "DISPATCHER" });
      expect(state.resetEpoch).toBe(before.resetEpoch + 1);
      expect(Math.abs(Date.parse(state.serverTime) - BEFORE_CUTOFF_TIME.getTime())).toBeLessThan(5_000);
      expect(await database.prisma!.order.count()).toBe(94);
      const days = await database.prisma!.planningDay.findMany({ orderBy: { depot: "asc" } });
      expect(days.map((d) => [d.depot, d.date.toISOString().slice(0, 10), d.state])).toEqual([
        ["Kandy", "2026-09-29", "OPEN"],
        ["Peliyagoda", "2026-09-29", "OPEN"],
      ]);
    }, 60000);

    it("produces identical state when run twice, the epoch moving on by one each time", async () => {
      const first = await asDispatcher("POST", "/api/demo/reset", { preset: "before-cutoff" });
      const a = await storyState();
      const second = await asDispatcher("POST", "/api/demo/reset", { preset: "before-cutoff" });
      const b = await storyState();
      expect(b).toEqual(a);
      expect(second.json().resetEpoch).toBe(first.json().resetEpoch + 1);
    }, 60000);

    it("clears what happened since, including immutable events", async () => {
      const prisma = database.prisma!;
      await prisma.order.update({ where: { displayId: "ORD10412" }, data: { status: "PLANNED" } });
      await prisma.notification.create({
        data: {
          role: "DISPATCHER",
          depot: "Peliyagoda",
          kind: "orders_closed",
          titleKey: "notifications.orders_closed",
          params: {},
          entityRef: {},
        },
      });
      await asDispatcher("POST", "/api/demo/reset", { preset: "before-cutoff" });
      expect((await prisma.order.findUniqueOrThrow({ where: { displayId: "ORD10412" } })).status).toBe("DEFERRED");
      expect(await prisma.notification.count()).toBe(0);
    }, 60000);

    it("refuses the presets that are not built yet", async () => {
      const res = await asDispatcher("POST", "/api/demo/reset", { preset: "plan-published" });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: "ILLEGAL_TRANSITION", params: { preset: "plan-published" } });
    });
  });

  describe("clock and tick", () => {
    it("closes the day at cutoff once, notifies the dispatcher, and opens the next day", async () => {
      await asDispatcher("POST", "/api/demo/reset", { preset: "before-cutoff" });
      expect((await asDispatcher("POST", "/api/demo/tick")).json().transitionsApplied).toBe(0);

      const after = new Date(cutoffAt("2026-09-29") + 60_000).toISOString();
      const moved = await asDispatcher("POST", "/api/demo/clock", { serverTime: after });
      expect(moved.statusCode).toBe(200);
      expect(Math.abs(Date.parse(moved.json().serverTime) - Date.parse(after))).toBeLessThan(5_000);

      const tick = (await asDispatcher("POST", "/api/demo/tick")).json();
      expect(tick.transitionsApplied).toBe(2);
      expect((await asDispatcher("POST", "/api/demo/tick")).json().transitionsApplied).toBe(0);

      const prisma = database.prisma!;
      const days = await prisma.planningDay.findMany({ orderBy: [{ date: "asc" }, { depot: "asc" }] });
      expect(days.map((d) => [d.depot, d.date.toISOString().slice(0, 10), d.state])).toEqual([
        ["Kandy", "2026-09-29", "CLOSED"],
        ["Peliyagoda", "2026-09-29", "CLOSED"],
        ["Kandy", "2026-09-30", "OPEN"],
        ["Peliyagoda", "2026-09-30", "OPEN"],
      ]);
      expect(days[0]!.ordersClosedAt?.getTime()).toBe(cutoffAt("2026-09-29"));

      const notes = await prisma.notification.findMany({ where: { kind: "orders_closed" } });
      expect(notes.map((n) => (n.params as { depot: string }).depot).sort()).toEqual(["Kandy", "Peliyagoda"]);
      const peliyagoda = notes.find((n) => (n.params as { depot: string }).depot === "Peliyagoda")!;
      expect(peliyagoda.params).toMatchObject({ date: "2026-09-29", orders: 86 });
    }, 60000);

    it("reports serverTime on the demo clock but keeps sessions on real time", async () => {
      // Far beyond the 12 h web-session TTL from real now in either direction.
      const target = new Date(Date.now() + 40 * 3600_000);
      await asDispatcher("POST", "/api/demo/clock", { serverTime: target.toISOString() });
      const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: dispatcher.cookies });
      expect(me.statusCode).toBe(200);
      expect(Math.abs(Date.parse(me.json().serverTime) - target.getTime())).toBeLessThan(5_000);
    });
  });

  describe("pg-boss tick job", () => {
    it("runs the tick from the queue", async () => {
      let ticks = 0;
      const jobs = await startJobs({
        connectionString: url!,
        schema: `pgboss_${schema}`.slice(0, 60),
        tick: async () => ++ticks,
        log: { info: () => {}, error: () => {} },
      });
      try {
        await jobs.boss.send(TICK_QUEUE);
        const deadline = Date.now() + 20_000;
        while (ticks === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
        expect(ticks).toBeGreaterThan(0);
      } finally {
        await jobs.stop();
        await admin.query(`DROP SCHEMA IF EXISTS "${`pgboss_${schema}`.slice(0, 60)}" CASCADE`);
      }
    }, 60000);
  });
});
