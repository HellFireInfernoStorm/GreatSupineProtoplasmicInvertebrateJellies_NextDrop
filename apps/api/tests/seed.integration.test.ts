// The seed against PostgreSQL: a fresh database is seeded, and running the seed again changes nothing (issue #30).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verify } from "argon2";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNTS, DEMO_PASSWORD, DEMO_PIN } from "../prisma/seed/accounts";
import { runSeed, type SeedSummary } from "../prisma/seed/index";
import { PEAK_DAY_WORKSHOP } from "../prisma/seed/peak-day";
import { HILL_RUN_WORKSHOP, STORY_CHILLED_ORDER_ID } from "../prisma/seed/story";
import { uuidv7 } from "uuidv7";
import { createDatabase, type Database } from "../src/lib/database";
import { CSRF_HEADER } from "../src/modules/auth";
import { buildServer } from "../src/server";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test.");
}
const schema = `issue30_${randomUUID().replaceAll("-", "")}`;
const suiteUrl = url ? new URL(url) : undefined;
suiteUrl?.searchParams.set("schema", schema);
const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
let database: Database;
let first: SeedSummary;

/** Row count and a content hash of every table in the suite schema. */
async function snapshot(): Promise<Record<string, string>> {
  const { rows: tables } = await admin.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1",
    [schema],
  );
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const qualified = `"${schema}"."${table_name}"`;
    const { rows } = await admin.query<{ n: string; h: string | null }>(
      `SELECT count(*)::text AS n, md5(string_agg(t::text, ',' ORDER BY t::text)) AS h FROM ${qualified} t`,
    );
    out[table_name] = `${rows[0]?.n}:${rows[0]?.h ?? ""}`;
  }
  return out;
}

async function count(table: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
  return rows[0]?.n ?? 0;
}

describe.skipIf(!url)("seed (PostgreSQL)", () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
    await promisify(execFile)(process.execPath, [cli, "migrate", "deploy"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: suiteUrl!.toString() },
      timeout: 60000,
    });
    database = createDatabase(suiteUrl!.toString());
    first = await runSeed(database.prisma!);
  }, 180000);

  afterAll(async () => {
    await database?.close();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  it("seeds a fresh database", async () => {
    expect(first.wrote).toBe(true);
    expect(first.resetEpoch).toBe(1);
    expect(await count("outlets")).toBe(120);
    expect(await count("vehicles")).toBe(60);
    expect(await count("drivers")).toBe(60);
    expect(await count("road_conditions")).toBeGreaterThan(10000);
    expect(await count("users")).toBe(ACCOUNTS.length);
    expect(await count("orders")).toBe(94);
    expect(await count("vehicle_availability")).toBe(PEAK_DAY_WORKSHOP.length + HILL_RUN_WORKSHOP.length);
    expect(await count("outlet_service_states")).toBe(120);
    expect(await count("weekly_demand_history")).toBe(72);
    expect(await count("demo_state")).toBe(1);
  });

  it("stores order sizes, lines and a timeline the status agrees with", async () => {
    const order = await database.prisma!.order.findUniqueOrThrow({
      where: { displayId: STORY_CHILLED_ORDER_ID },
      include: { orderLine_orderId: true, orderEvent_orderId: { orderBy: { id: "asc" } } },
    });
    expect(order).toMatchObject({ status: "DEFERRED", deferredCount: 1, tempRequirement: "chilled" });
    expect(order.orderLine_orderId.map((l) => l.qtyOrdered).sort()).toEqual([12, 8].sort());
    expect(order.orderEvent_orderId.map((e) => e.type)).toEqual(["ORDER_PLACED", "ORDER_DEFERRED"]);
    expect(order.weightG).toBe(Math.ceil((12 * 13.2 + 8 * 11.5) * 1000));
  });

  it("hashes the demo credentials with argon2", async () => {
    for (const account of ACCOUNTS) {
      const user = await database.prisma!.user.findUniqueOrThrow({ where: { loginId: account.loginId } });
      const secret = account.role === "LOADER" || account.role === "DRIVER" ? DEMO_PIN : DEMO_PASSWORD;
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verify(user.passwordHash, secret)).toBe(true);
    }
  });

  it("lets every seeded account sign in through /auth/login with the demo credentials", async () => {
    const app = await buildServer(
      {},
      {
        database: { ...database, close: async () => {} },
        auth: {
          sessionSecret: "seed-integration-secret-seed-integration",
          loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
        },
      },
    );
    try {
      for (const account of ACCOUNTS) {
        const payload =
          account.role === "DISPATCHER"
            ? { role: account.role, email: account.loginId, password: account.secret, depot: "Kandy" }
            : account.role === "STORE"
              ? { role: account.role, loginId: account.loginId, password: account.secret }
              : { role: account.role, loginId: account.loginId, pin: account.secret, deviceId: uuidv7() };
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload,
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(res.statusCode, `${account.loginId}: ${res.body}`).toBe(200);
      }
    } finally {
      await app.close();
    }
  });

  it("changes nothing when run again, the reset epoch included", async () => {
    const before = await snapshot();
    const second = await runSeed(database.prisma!);
    expect(second.wrote).toBe(false);
    expect(second.resetEpoch).toBe(1);
    for (const section of Object.values(second.sections)) expect(section).toEqual({ created: 0, updated: 0 });
    expect(await snapshot()).toEqual(before);
  }, 60000);

  it("restores changed reference data, keeps demo progress, and then bumps the epoch", async () => {
    const prisma = database.prisma!;
    await prisma.product.update({ where: { sku: "FR-MILK-CRATE" }, data: { name: "edited" } });
    await prisma.order.update({ where: { displayId: STORY_CHILLED_ORDER_ID }, data: { deferredCount: 5 } });
    const third = await runSeed(prisma);
    expect(third.sections.catalogue).toEqual({ created: 0, updated: 1 });
    expect(third.wrote).toBe(true);
    expect(third.resetEpoch).toBe(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: "FR-MILK-CRATE" } })).name).not.toBe("edited");
    const order = await prisma.order.findUniqueOrThrow({ where: { displayId: STORY_CHILLED_ORDER_ID } });
    expect(order.deferredCount).toBe(5);
  }, 60000);
});
