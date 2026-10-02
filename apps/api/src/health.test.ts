import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer, type App } from "./server";

describe("ops endpoints", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildServer();
  });
  afterAll(() => app.close());

  it("GET /api/healthz returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/readyz returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });
});
