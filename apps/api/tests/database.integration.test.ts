import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/lib/database";
import { buildServer } from "../src/server";
import { repositoryMigrations } from "../src/lib/readiness";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test; see prisma-rules.md.",
  );
}
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
let client: PoolClient;
type FixtureKey =
  | "district"
  | "outlet"
  | "vehicle"
  | "user"
  | "device"
  | "day"
  | "trip"
  | "trip2"
  | "order"
  | "event"
  | "version"
  | "change";
let ids: Record<FixtureKey, string>;

async function fixtures(connection: PoolClient) {
  const keys = [
    "district",
    "outlet",
    "vehicle",
    "user",
    "device",
    "day",
    "trip",
    "trip2",
    "order",
    "event",
    "version",
    "change",
  ];
  const f = Object.fromEntries(keys.map((key) => [key, randomUUID()])) as Record<FixtureKey, string>;
  await connection.query(
    `INSERT INTO districts (id,name,depot,"roadClass","freeFlowKmh","depotToDistrictKm","depotToDistrictFreeflowMin","interStopKm","interStopFreeflowMin") VALUES ($1,$2,'test','urban',40,10,15,1,3)`,
    [f.district, f.district],
  );
  await connection.query(
    `INSERT INTO outlets (id,"displayId",brand,depot,"dockType","parkingConstraint","windowOpen","windowClose","districtId") VALUES ($1,$2,'Fresh','test','rear_dock','normal',0,480,$3)`,
    [f.outlet, f.outlet, f.district],
  );
  await connection.query(
    `INSERT INTO vehicles (id,"displayId",type,temp,"weightCapKg","volumeCapM3","fuelType","kmPerL","weeklyFuelQuotaL",depot) VALUES ($1,$2,'van','reefer',1000,10,'diesel',4.7,100,'test')`,
    [f.vehicle, f.vehicle],
  );
  await connection.query(
    `INSERT INTO users (id,"loginId",role,"displayName","passwordHash") VALUES ($1,$2,'DISPATCHER','Test','not-a-real-password')`,
    [f.user, f.user],
  );
  await connection.query(
    `INSERT INTO devices (id,"userId",kind,"appVersion","lastSeenAt") VALUES ($1,$2,'FIELD','test',now())`,
    [f.device, f.user],
  );
  await connection.query(`INSERT INTO planning_days (id,depot,date) VALUES ($1,$2,'2026-10-03')`, [f.day, f.day]);
  for (const [id, tripNo] of [
    [f.trip, 1],
    [f.trip2, 2],
  ]) {
    await connection.query(
      `INSERT INTO trips (id,"displayId","tripNo",brand,"plannedDepart","plannedMinutes",km,litres,"planningDayId","vehicleId","districtId") VALUES ($1,$2,$3,'Fresh',240,60,10,2,$4,$5,$6)`,
      [id, id, tripNo, f.day, f.vehicle, f.district],
    );
  }
  await connection.query(
    `INSERT INTO orders (id,"displayId",brand,"tempRequirement","requestedDate","currentDate","weightG","volumeL","idempotencyKey","outletId") VALUES ($1,$2,'Fresh','chilled','2026-10-03','2026-10-03',1000,1,$2,$3)`,
    [f.order, f.order, f.outlet],
  );
  await connection.query(
    `INSERT INTO order_events (id,type,source,"actorRole","capturedAt",payload,"actorUserId","orderId") VALUES ($1,'ORDER_PLACED','SERVER','DISPATCHER',now(),'{}',$2,$3)`,
    [f.event, f.user, f.order],
  );
  await connection.query(
    `INSERT INTO plan_versions (id,version,"draftRevision",snapshot,summary,"planningDayId","publishedBy") VALUES ($1,1,0,'{}','{}',$2,$3)`,
    [f.version, f.day, f.user],
  );
  await connection.query(
    `INSERT INTO plan_version_changes (id,change,"planVersionId","orderId","tripId") VALUES ($1,'ADDED',$2,$3,$4)`,
    [f.change, f.version, f.order, f.trip],
  );
  return f;
}

async function stop(connection: PoolClient, trip: string, order: string, status = "PLANNED") {
  return connection.query(
    `INSERT INTO trip_stops (id,"tripId","orderId","tripStatus",seq,"etaMin","windowOpen","windowClose","serviceMin") VALUES ($1,$2,$3,$4,1,300,0,480,10)`,
    [randomUUID(), trip, order, status],
  );
}
async function rejects(sql: string, values: unknown[], code: string) {
  await client.query("SAVEPOINT invalid_write");
  try {
    await expect(client.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT invalid_write");
  }
}

beforeAll(async () => {
  const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  await promisify(execFile)(process.execPath, [cli, "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    timeout: 30000,
  });
});
beforeEach(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  ids = await fixtures(client);
});
afterEach(async () => {
  await client.query("ROLLBACK");
  client.release();
});
afterAll(async () => {
  await pool.end();
});

describe("migration safeguards", () => {
  it.each(["order_events", "plan_versions", "plan_version_changes"])(
    "rejects UPDATE and DELETE on %s",
    async (table) => {
      const id = table === "order_events" ? ids.event : table === "plan_versions" ? ids.version : ids.change;
      await rejects(`UPDATE ${table} SET id = id WHERE id = $1`, [id], "23514");
      await rejects(`DELETE FROM ${table} WHERE id = $1`, [id], "23514");
    },
  );
  it("rejects invalid quantities, capacities and trip numbers", async () => {
    await rejects(`UPDATE orders SET "weightG" = 0 WHERE id = $1`, [ids.order], "23514");
    await rejects(`UPDATE vehicles SET "volumeCapM3" = -1 WHERE id = $1`, [ids.vehicle], "23514");
    await rejects(`UPDATE trips SET "tripNo" = 3 WHERE id = $1`, [ids.trip], "23514");
    const product = randomUUID();
    await client.query(
      `INSERT INTO products (id,sku,name,brand,"tempRequirement","unitLabel","unitWeightKg","unitVolumeM3") VALUES ($1::uuid,$1::text,'Test','Fresh','chilled','crate',1,0.001)`,
      [product],
    );
    await rejects(
      `INSERT INTO order_lines (id,"orderId","productId","qtyOrdered","unitWeightKg","unitVolumeM3") VALUES ($1,$2,$3,-1,1,0.001)`,
      [randomUUID(), ids.order, product],
      "23514",
    );
  });
  it("enforces event idempotency by both client ID and per-device sequence", async () => {
    const event = randomUUID(),
      clientEvent = randomUUID();
    const sql = `INSERT INTO order_events (id,"clientEventId","deviceId","deviceSeq",type,source,"actorRole","capturedAt",payload,"actorUserId","orderId") VALUES ($1,$2,$3,$4,'LOAD_CONFIRMED','FIELD','LOADER',now(),'{}',$5,$6)`;
    await client.query(sql, [event, clientEvent, ids.device, 1, ids.user, ids.order]);
    await rejects(sql, [randomUUID(), clientEvent, ids.device, 2, ids.user, ids.order], "23505");
    await rejects(sql, [randomUUID(), randomUUID(), ids.device, 1, ids.user, ids.order], "23505");
    await rejects(sql, [randomUUID(), randomUUID(), ids.device, null, ids.user, ids.order], "23514");
  });
  it("rejects duplicate vehicle-trip numbers and publication revisions", async () => {
    await rejects(`UPDATE trips SET "tripNo" = 1 WHERE id = $1`, [ids.trip2], "23505");
    await rejects(
      `INSERT INTO plan_versions (id,version,"draftRevision",snapshot,summary,"planningDayId","publishedBy") VALUES ($1,2,0,'{}','{}',$2,$3)`,
      [randomUUID(), ids.day, ids.user],
      "23505",
    );
  });
  it("releases an assignment on cancellation and rejects reactivation that would duplicate it", async () => {
    await stop(client, ids.trip, ids.order);
    await client.query("SAVEPOINT assignment");
    await expect(stop(client, ids.trip2, ids.order)).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT assignment");
    await client.query(`UPDATE trips SET status = 'CANCELLED' WHERE id = $1`, [ids.trip]);
    expect(
      (await client.query(`SELECT "tripStatus" FROM trip_stops WHERE "tripId" = $1`, [ids.trip])).rows[0].tripStatus,
    ).toBe("CANCELLED");
    await stop(client, ids.trip2, ids.order);
    await rejects(`UPDATE trips SET status = 'READY' WHERE id = $1`, [ids.trip], "23505");
    expect((await client.query(`SELECT status FROM trips WHERE id = $1`, [ids.trip])).rows[0].status).toBe("CANCELLED");
  });
  it("cannot bypass active uniqueness by falsifying the stop's parent status", async () => {
    await client.query("SAVEPOINT mismatched_status");
    await expect(stop(client, ids.trip, ids.order, "CANCELLED")).rejects.toMatchObject({ code: "23503" });
    await client.query("ROLLBACK TO SAVEPOINT mismatched_status");
    await stop(client, ids.trip, ids.order);
    await client.query(`UPDATE trips SET status = 'COMPLETE' WHERE id = $1`, [ids.trip]);
    await client.query("SAVEPOINT completed_assignment");
    await expect(stop(client, ids.trip2, ids.order)).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT completed_assignment");
  });
  it("initializes exactly one FeedCounter and prevents removal or extra singleton rows", async () => {
    expect((await client.query(`SELECT head FROM feed_counter`)).rows).toEqual([{ head: "0" }]);
    await rejects(`INSERT INTO feed_counter (id,singleton) VALUES ($1,true)`, [randomUUID()], "23505");
    await rejects(`INSERT INTO feed_counter (id,singleton) VALUES ($1,false)`, [randomUUID()], "23514");
    await rejects(`DELETE FROM feed_counter`, [], "23514");
    await client.query(`UPDATE feed_counter SET head = head + 2`);
    expect((await client.query(`SELECT head FROM feed_counter`)).rows[0].head).toBe("2");
  });
  it("serializes competing assignments and commits at most one", async () => {
    // Commit the unique fixture so both connections see it in this disposable test database.
    await client.query("COMMIT");
    const first = await pool.connect(),
      second = await pool.connect();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await stop(first, ids.trip, ids.order);
      const pending = expect(stop(second, ids.trip2, ids.order)).rejects.toMatchObject({ code: "23505" });
      await first.query("COMMIT");
      await pending;
      await second.query("ROLLBACK");
      expect((await client.query(`SELECT id FROM trip_stops WHERE "orderId" = $1`, [ids.order])).rowCount).toBe(1);
    } finally {
      await first.query("ROLLBACK");
      await second.query("ROLLBACK");
      first.release();
      second.release();
      await client.query("BEGIN");
    }
  });
  it("preserves the SQL triggers, checks and partial index after deployment", async () => {
    expect(
      (await client.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%immutable'`))
        .rowCount,
    ).toBe(3);
    expect(
      (
        await client.query(
          `SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
        )
      ).rowCount,
    ).toBeGreaterThan(25);
    const index = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'trip_stops_active_order_key'`);
    expect(index.rows[0].indexdef).toContain("WHERE");
  });
});

describe("real database readiness", () => {
  it("returns 200 after successful migration deployment", async () => {
    const database = createDatabase(url);
    const app = await buildServer({}, { ready: database.ready });
    try {
      expect(repositoryMigrations().size).toBe(1);
      const result = await app.inject("/api/readyz");
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ status: "ok", checks: { database: "ok", migrations: "ok" } });
    } finally {
      await app.close();
      await database.close();
    }
  });
  it("reports unavailable for a database without migrations", async () => {
    const schema = `empty_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const emptyUrl = new URL(url!);
    emptyUrl.searchParams.set("options", `-c search_path=${schema}`);
    const database = createDatabase(emptyUrl.toString());
    try {
      expect(await database.ready()).toEqual({
        status: "unavailable",
        checks: { database: "ok", migrations: "failed" },
      });
    } finally {
      await database.close();
      await pool.query(`DROP SCHEMA "${schema}"`);
    }
  });
});
