// The store orders API over the real seed: seeded orders project to the contract DTO, and a seeded store can order.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import { STORY_CHILLED_ORDER_ID } from "../prisma/seed/story";
import { HILL_STORE_OUTLET_ID, STORY_DATE } from "../prisma/seed/story-fixtures";
import { CSRF_HEADER, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping seeded orders tests: set TEST_DATABASE_URL to a disposable _test database.");

describe.skipIf(!testDatabaseUrl)("store orders over the seed", () => {
  let suite: SuiteDatabase;
  let app: App;
  let cookies: Record<string, string>;
  let csrf: string;
  // Sat 26 Sep 2026, 10:00 Asia/Colombo: before the cutoff for Mon 28 Sep.
  const clock = new Date("2026-09-26T04:30:00.000Z");

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue42seed");
    await runSeed(suite.prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      // Ishara, the hill-run store that receives the story order ORD10412.
      payload: { role: "STORE", loginId: HILL_STORE_OUTLET_ID, password: DEMO_PASSWORD },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(login.statusCode, login.body).toBe(200);
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    csrf = login.json().csrfToken;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it("projects the store's seeded orders, including the deferred story order", async () => {
    const res = await app.inject({ method: "GET", url: `/api/store/orders?date=${STORY_DATE}&limit=100`, cookies });
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as { id: string; displayId: string; status: string; deferral: unknown }[];
    // The deferred chilled order and the dry order for the same delivery.
    expect(items.length).toBeGreaterThanOrEqual(2);
    const story = items.find((o) => o.displayId === STORY_CHILLED_ORDER_ID);
    expect(story).toMatchObject({
      status: "DEFERRED",
      deferral: expect.objectContaining({ reasonCode: "REEFER_SHORTAGE" }),
    });
    const detail = await app.inject({ method: "GET", url: `/api/store/orders/${story!.id}`, cookies });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().timeline.map((e: { type: string }) => e.type)).toEqual(["ORDER_PLACED", "ORDER_DEFERRED"]);
  });

  it("places a chilled order from the seeded catalogue after the seeded orders", async () => {
    const products = await suite.prisma.product.findMany({
      where: { brand: "Fresh", tempRequirement: "chilled" },
      take: 2,
      orderBy: { sku: "asc" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/store/orders",
      cookies,
      headers: { [CSRF_HEADER]: csrf, "idempotency-key": randomUUID() },
      payload: { requestedDate: "2026-09-28", lines: products.map((p) => ({ productId: p.id, qty: 3 })) },
    });
    expect(res.statusCode, res.body).toBe(201);
    const highest = await suite.prisma.order.findFirstOrThrow({
      orderBy: { displayId: "desc" },
      where: { NOT: { id: res.json().id } },
    });
    expect(Number(res.json().displayId.slice(3))).toBe(Number(highest.displayId.slice(3)) + 1);
    expect(res.json()).toMatchObject({ currentDate: "2026-09-28", status: "ORDERED", tempRequirement: "chilled" });
  });
});
