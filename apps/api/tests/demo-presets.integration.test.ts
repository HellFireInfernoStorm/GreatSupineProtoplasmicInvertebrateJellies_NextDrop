// Demo presets against PostgreSQL (issue #56): each preset reaches the same state every time, through the real
// service functions on the server clock.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cutoffAt } from "@nextdrop/rules";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DISPATCHER_LOGIN_ID } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import { createDatabase, type Database } from "../src/lib/database";
import { CSRF_HEADER, SESSION_COOKIE } from "../src/modules/auth";
import { ORDERS_CLOSED_TIME } from "../src/modules/demo";
import { buildServer, type App } from "../src/server";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test.");
}
const schema = `issue56_${randomUUID().replaceAll("-", "")}`;
const suiteUrl = url ? new URL(url) : undefined;
suiteUrl?.searchParams.set("schema", schema);
const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
const auth = {
  sessionSecret: "demo-integration-secret-demo-integration",
  demoMode: true,
  loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
};
let database: Database;
let app: App;
let dispatcher: { cookies: Record<string, string>; csrf: string };

function reset(preset: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url: "/api/demo/reset",
    cookies: dispatcher.cookies,
    headers: { [CSRF_HEADER]: dispatcher.csrf },
    payload: { preset },
  });
}

/** What a judge sees after a preset, minus generated IDs and the few milliseconds the clock ran while it was built. */
async function presetState() {
  const prisma = database.prisma!;
  const orders = await prisma.order.findMany({
    orderBy: { displayId: "asc" },
    include: { outlet: { select: { displayId: true } }, orderEvent_orderId: { select: { type: true } } },
  });
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const days = await prisma.planningDay.findMany({ orderBy: [{ depot: "asc" }, { date: "asc" }] });
  const demo = await prisma.demoState.findUniqueOrThrow({ where: { singleton: true } });
  return {
    orderCount: orders.length,
    byStatus,
    orders: orders.map((o) => [o.displayId, o.outlet.displayId, o.status, o.orderEvent_orderId.map((e) => e.type)]),
    days: days.map((d) => [
      d.depot,
      d.date.toISOString().slice(0, 10),
      d.state,
      d.ordersClosedAt?.toISOString() ?? null,
    ]),
    preset: demo.preset,
  };
}

describe.skipIf(!url)("demo presets (PostgreSQL)", () => {
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
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "DISPATCHER", email: DISPATCHER_LOGIN_ID, password: DEMO_PASSWORD, depot: "Peliyagoda" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    dispatcher = { cookies: { [SESSION_COOKIE]: cookie.value }, csrf: res.json().csrfToken as string };
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

  describe("orders-closed", () => {
    it("places the step-1 orders, moves the clock past 16:00 and closes both days", async () => {
      const before = await reset("before-cutoff");
      const baseline = await presetState();
      const res = await reset("orders-closed");
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ preset: "orders-closed", lastResetBy: "DISPATCHER" });
      expect(res.json().resetEpoch).toBe(before.json().resetEpoch + 1);
      expect(Math.abs(Date.parse(res.json().serverTime) - ORDERS_CLOSED_TIME.getTime())).toBeLessThan(5_000);

      const state = await presetState();
      // Two new orders, Dilini's dry and chilled, both ORDERED for Tue 29 Sep at OUT004; nothing else moved.
      expect(state.orderCount).toBe(baseline.orderCount + 2);
      expect(state.byStatus["ORDERED"]).toBe((baseline.byStatus["ORDERED"] ?? 0) + 2);
      const placed = state.orders.filter((o) => !baseline.orders.some((b) => b[0] === o[0]));
      expect(placed).toHaveLength(2);
      for (const [, outlet, status, events] of placed) {
        expect(outlet).toBe("OUT004");
        expect(status).toBe("ORDERED");
        expect(events).toEqual(["ORDER_PLACED"]);
      }
      // The tick closed the story day for both depots at the cutoff instant, and opened the next day.
      const closedAt = new Date(cutoffAt("2026-09-29")).toISOString();
      expect(state.days).toEqual([
        ["Kandy", "2026-09-29", "CLOSED", closedAt],
        ["Kandy", "2026-09-30", "OPEN", null],
        ["Peliyagoda", "2026-09-29", "CLOSED", closedAt],
        ["Peliyagoda", "2026-09-30", "OPEN", null],
      ]);
    }, 90000);

    it("reaches the same state every time, the epoch moving on by one each run", async () => {
      const first = await reset("orders-closed");
      const a = await presetState();
      const second = await reset("orders-closed");
      const b = await presetState();
      expect(b).toEqual(a);
      expect(second.json().resetEpoch).toBe(first.json().resetEpoch + 1);
    }, 90000);
  });

  describe("presets that are not built yet", () => {
    it.each(["plan-published", "loading", "mid-run", "clash-ready"])("refuses %s with 409", async (preset) => {
      const res = await reset(preset);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: "ILLEGAL_TRANSITION", params: { preset } });
    });
  });
});
