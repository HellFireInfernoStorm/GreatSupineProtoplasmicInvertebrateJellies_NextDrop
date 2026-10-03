import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type App } from "../../server";
import { publicResource, selfResource } from "../policy";
import { assertRoutePolicy, CSRF_HEADER } from "./index";

const ready = async () => ({ status: "ok" as const, checks: { database: "ok" as const, migrations: "ok" as const } });
let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("route policy declarations", () => {
  it("rejects a route without a policy", () => {
    expect(() => assertRoutePolicy({ method: "GET", url: "/api/auth/me", config: {} })).toThrow(/declares no policy/);
  });

  it("rejects a policy whose action does not match the contract method and path", () => {
    const policy = { action: "me" as const, resourceResolver: selfResource };
    expect(() => assertRoutePolicy({ method: "POST", url: "/api/auth/me", config: { policy } })).toThrow(
      /does not match/,
    );
    expect(() => assertRoutePolicy({ method: "GET", url: "/api/auth/whoami", config: { policy } })).toThrow(
      /does not match/,
    );
    expect(() =>
      assertRoutePolicy({ method: "GET", url: "/api/x", config: { policy: { ...policy, action: "x" as never } } }),
    ).toThrow(/unknown action/);
    expect(() =>
      assertRoutePolicy({ method: "GET", url: "/api/auth/me", config: { policy: { action: "me" } as never } }),
    ).toThrow(/resourceResolver/);
  });

  it("accepts a matching declaration, including the implicit HEAD route", () => {
    const policy = { action: "health" as const, resourceResolver: publicResource };
    expect(() => assertRoutePolicy({ method: "GET", url: "/api/healthz", config: { policy } })).not.toThrow();
    expect(() => assertRoutePolicy({ method: "HEAD", url: "/api/healthz", config: { policy } })).not.toThrow();
  });

  it("refuses to register a route without a policy, directly or inside a module plugin", async () => {
    app = await buildServer({}, { ready });
    expect(() => app!.get("/api/unguarded", async () => ({ leaked: true }))).toThrow(/declares no policy/);
    void app.register(async (module) => {
      module.get("/api/store/orders", async () => []);
    });
    await expect(app.ready()).rejects.toThrow(/declares no policy/);
  });
});

describe("guard without a session", () => {
  it("returns 401 in the shared error shape for session routes", async () => {
    app = await buildServer({}, { ready });
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message_key: "errors.unauthenticated",
      params: {},
      requestId: expect.any(String),
    });
  });

  it("ignores a forged or unsigned session cookie", async () => {
    app = await buildServer({}, { ready });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { nextdrop_session: "018f0000-0000-7000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a login without the custom CSRF header before reading credentials", async () => {
    app = await buildServer({}, { ready });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { role: "LOADER", loginId: "LDR001", pin: "1234", deviceId: "018f0000-0000-7000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "FORBIDDEN", message_key: "errors.csrfMissing" });
  });

  it("returns 400 SCHEMA_INVALID for a malformed login body", async () => {
    app = await buildServer({}, { ready });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { [CSRF_HEADER]: "1" },
      payload: { role: "LOADER", loginId: "DRV001", pin: "1234" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("returns 404 in the shared error shape for unknown routes", async () => {
    app = await buildServer({}, { ready });
    const res = await app.inject({ method: "GET", url: "/api/nothing-here" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("security headers", () => {
  it("sends a content security policy and helmet's defaults", async () => {
    app = await buildServer({}, { ready });
    const res = await app.inject({ method: "GET", url: "/api/healthz" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("demo access", () => {
  const demoRoute = (instance: App) =>
    instance.get(
      "/api/demo/state",
      { config: { policy: { action: "demoState", resourceResolver: selfResource } } },
      async () => ({ ok: true }),
    );

  it("is not found outside demo mode", async () => {
    app = await buildServer({}, { ready, auth: { demoMode: false, demoScriptKey: "k".repeat(32) } });
    demoRoute(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/demo/state",
      headers: { "x-nextdrop-script-key": "k".repeat(32) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("accepts the script key in demo mode and refuses a wrong or disabled key", async () => {
    app = await buildServer({}, { ready, auth: { demoMode: true, demoScriptKey: "k".repeat(32) } });
    demoRoute(app);
    const ok = await app.inject({
      method: "GET",
      url: "/api/demo/state",
      headers: { "x-nextdrop-script-key": "k".repeat(32) },
    });
    expect(ok.statusCode).toBe(200);
    const wrong = await app.inject({
      method: "GET",
      url: "/api/demo/state",
      headers: { "x-nextdrop-script-key": "x" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("disables the script-key path when the key is empty", async () => {
    app = await buildServer({}, { ready, auth: { demoMode: true, demoScriptKey: "" } });
    demoRoute(app);
    const res = await app.inject({ method: "GET", url: "/api/demo/state", headers: { "x-nextdrop-script-key": "" } });
    expect(res.statusCode).toBe(401);
  });
});
