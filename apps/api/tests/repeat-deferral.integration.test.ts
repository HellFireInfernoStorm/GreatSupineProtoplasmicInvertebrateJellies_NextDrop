// The repeat-deferral walkthrough (#135): the dispatcher defers ORD10412, carried over from yesterday's run, again.
// The draft must stay publishable as far as validation goes (REPEAT_DEFERRAL is a warning), publish must refuse it
// without a justification note, and accept it with one.
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
import { STORY_CHILLED_ORDER_ID } from "../prisma/seed/story";
import { createDatabase, type Database } from "../src/lib/database";
import { CSRF_HEADER, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test.");
}
const schema = `issue135_${randomUUID().replaceAll("-", "")}`;
const suiteUrl = url ? new URL(url) : undefined;
suiteUrl?.searchParams.set("schema", schema);
const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
const DATE = "2026-09-29";
const day = (path: string) => `/api/dispatch/days/${DATE}${path}?depot=Kandy`;
type DraftData = ApiDto<"draftData">;
let database: Database;
let app: App;
let session: { cookies: Record<string, string>; csrf: string };

function call(method: "POST" | "PUT", path: string, payload: object): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: path,
    cookies: session.cookies,
    headers: { [CSRF_HEADER]: session.csrf },
    payload,
  });
}

describe.skipIf(!url)("repeat-deferral walkthrough (PostgreSQL)", () => {
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
          sessionSecret: "repeat-deferral-integration-secret-135",
          loginRateLimit: { max: 1000, timeWindowMs: 60_000 },
        },
      },
    );
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "DISPATCHER", email: DISPATCHER_LOGIN_ID, password: DEMO_PASSWORD, depot: "Kandy" },
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

  it("requires a note to defer the carried-over Kandy order again, and publishes with one", async () => {
    const p = database.prisma!;
    const order = await p.order.findUniqueOrThrow({ where: { displayId: STORY_CHILLED_ORDER_ID } });
    const before = await p.deferral.count({ where: { orderId: order.id } });

    // 1. Propose: the allocator plans ORD10412 (the stock story defers nothing at Kandy).
    const proposed = await call("POST", day("/propose"), { revision: 0 });
    expect(proposed.statusCode, proposed.body).toBe(200);
    const draft = (proposed.json() as ApiDto<"proposeResponse">).draft;
    expect(draft.data.trips.some((t) => t.orderIds.includes(order.id))).toBe(true);

    // 2. The dispatcher takes it off its trip: a manual choice for a Fresh order is OTHER (deferral-explanation.md).
    const deferred = (note?: string): DraftData => ({
      trips: draft.data.trips.map((t) => ({ ...t, orderIds: t.orderIds.filter((id) => id !== order.id) })),
      unassignedOrderIds: [...draft.data.unassignedOrderIds, order.id],
      deferrals: [...draft.data.deferrals, { orderId: order.id, reasonCode: "OTHER", ...(note ? { note } : {}) }],
    });
    const saved = await call("PUT", day("/draft"), { revision: draft.revision, data: deferred() });
    expect(saved.statusCode, saved.body).toBe(200);
    const withoutNote = (saved.json() as ApiDto<"draftResponse">).draft!;

    // 3. Validation flags the repeat as a warning, not a hard violation, so D3 can still collect the note.
    const checked = await call("POST", day("/validate"), { data: deferred() });
    expect(checked.statusCode, checked.body).toBe(200);
    const validation = checked.json() as ApiDto<"validationResult">;
    expect(validation.ok, checked.body).toBe(true);
    expect(validation.violations).toContainEqual(
      expect.objectContaining({ code: "REPEAT_DEFERRAL", orderIds: [order.id] }),
    );

    // 4. Publish refuses the repeat deferral without a justification and writes nothing.
    const refused = await call("POST", day("/publish"), { revision: withoutNote.revision });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ code: "MISSING_DEFERRAL_REASON", params: { orders: 1 } });
    expect(await p.deferral.count({ where: { orderId: order.id } })).toBe(before);

    // 5. With the note, it publishes: a second consecutive deferral and a notice for the hill store.
    const note = "Reefer kept for the hospital run; store agreed to a Wednesday drop";
    const resaved = await call("PUT", day("/draft"), { revision: withoutNote.revision, data: deferred(note) });
    expect(resaved.statusCode, resaved.body).toBe(200);
    const withNote = (resaved.json() as ApiDto<"draftResponse">).draft!;
    const published = await call("POST", day("/publish"), { revision: withNote.revision });
    expect(published.statusCode, published.body).toBe(200);

    const rows = await p.deferral.findMany({ where: { orderId: order.id }, orderBy: { consecutiveDeferrals: "asc" } });
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ reasonCode: "OTHER", note, consecutiveDeferrals: 2 });
    const notices = await p.notification.findMany({ where: { kind: "deferral_notice", outletId: order.outletId } });
    expect(notices.length).toBeGreaterThan(0);
    expect(JSON.stringify(notices.map((n) => n.entityRef))).toContain(order.id);
  }, 60000);
});
