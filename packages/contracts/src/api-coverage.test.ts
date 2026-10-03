import { describe, expect, it } from "vitest";
import {
  apiFixtures,
  apiVariantFixtures,
  apiRouteFixtures,
  apiRoutes,
  apiSchemas,
  type ApiRouteDefinition,
  type ApiRouteName,
  type ApiSchemaName,
  fieldSnapshotSchema,
  loginRequestSchema,
  readNotificationsRequestSchema,
  validationErrorResponseSchema,
  clientEventSchema,
  blobBodySchema,
  readyResponseSchema,
  notReadyResponseSchema,
} from "./index";

// Hand-reviewed against api.md. Dropping a route must fail independently of the fixture registry.
const endpoints = [
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/auth/me",
  "POST /api/auth/reauth",
  "GET /api/ref/outlets",
  "GET /api/ref/vehicles",
  "GET /api/ref/products",
  "GET /api/ref/calendar",
  "GET /api/ref/reasons",
  "GET /api/store/cutoff",
  "GET /api/store/deliveries",
  "POST /api/store/orders",
  "GET /api/store/orders",
  "GET /api/store/orders/:id",
  "POST /api/store/orders/:id/cancel",
  "POST /api/store/orders/:id/receipt",
  "POST /api/store/orders/:id/issues",
  "GET /api/store/notifications",
  "POST /api/store/notifications/read",
  "GET /api/dispatch/days/:date",
  "POST /api/dispatch/days/:date/propose",
  "GET /api/dispatch/days/:date/draft",
  "PUT /api/dispatch/days/:date/draft",
  "POST /api/dispatch/days/:date/validate",
  "POST /api/dispatch/days/:date/publish",
  "GET /api/dispatch/days/:date/versions",
  "GET /api/dispatch/runs",
  "GET /api/dispatch/exceptions",
  "POST /api/dispatch/conflicts/:id/resolve",
  "POST /api/dispatch/issues/:id/resolve",
  "GET /api/dispatch/fleet",
  "PUT /api/dispatch/fleet",
  "GET /api/dispatch/outlook",
  "GET /api/dispatch/outlets/:id/history",
  "GET /api/field/snapshot",
  "POST /api/sync/events",
  "PUT /api/sync/blobs/:id",
  "POST /api/sync/heartbeat",
  "GET /api/changes",
  "GET /api/stream",
  "GET /api/notifications",
  "POST /api/notifications/read",
  "GET /api/demo/state",
  "POST /api/demo/clock",
  "POST /api/demo/reset",
  "POST /api/demo/tick",
  "GET /api/healthz",
  "GET /api/readyz",
];

describe("complete API DTO coverage", () => {
  it.each(Object.keys(apiSchemas) as ApiSchemaName[])("preserves every field of the exported %s fixture", (name) => {
    expect(apiSchemas[name].parse(apiFixtures[name])).toEqual(apiFixtures[name]);
  });

  it("covers every specified method and path exactly once", () => {
    expect(
      Object.values(apiRoutes)
        .map((route) => `${route.method} ${route.path}`)
        .sort(),
    ).toEqual([...endpoints].sort());
    expect(Object.keys(apiRouteFixtures).sort()).toEqual(Object.keys(apiRoutes).sort());
    expect(Object.keys(apiFixtures).sort()).toEqual(Object.keys(apiSchemas).sort());
  });

  it("exports complete mocks for every role, result status and exception variant", () => {
    const groups = {
      loginRequest: ["STORE", "DISPATCHER", "LOADER", "DRIVER"],
      sessionUser: ["STORE", "DISPATCHER", "LOADER", "DRIVER"],
      fieldSnapshot: ["LOADER", "DRIVER"],
      syncEventResult: ["ACCEPTED", "DUPLICATE", "HELD_CONFLICT", "REJECTED"],
      exception: ["CONFLICT", "ISSUE", "SHORT", "DAMAGED", "FAILED", "PROBLEM"],
    };
    for (const name of Object.keys(groups) as (keyof typeof groups)[]) {
      expect(Object.keys(apiVariantFixtures[name]).sort()).toEqual([...groups[name]].sort());
      for (const fixture of Object.values(apiVariantFixtures[name]))
        expect(apiSchemas[name].parse(fixture)).toEqual(fixture);
    }
  });

  it.each(Object.keys(apiRoutes) as ApiRouteName[])(
    "makes %s requests and response statuses usable by API and web",
    (name) => {
      const route: ApiRouteDefinition = apiRoutes[name];
      const fixture = apiRouteFixtures[name];
      expect(Object.keys(fixture.request).sort()).toEqual(Object.keys(route.request).sort());
      expect(Object.keys(fixture.responses).sort()).toEqual(Object.keys(route.responses).sort());
      for (const [part, schema] of Object.entries(route.request)) {
        const input = (fixture.request as Record<string, unknown>)[part];
        expect(apiSchemas[schema].parse(input)).toEqual(input);
      }
      for (const [status, schema] of Object.entries(route.responses)) {
        const input = (fixture.responses as Record<string, unknown>)[status];
        expect(apiSchemas[schema].parse(input)).toEqual(input);
      }
      if (route.method === "GET") expect(route.request.body).toBeUndefined();
      else expect(route.request.headers).toBeDefined();
      expect(route.roles).not.toContain("SYSTEM");
      if (route.path.startsWith("/api/store/")) expect(route.roles).toEqual(["STORE"]);
      if (route.path.startsWith("/api/dispatch/")) expect(route.roles).toEqual(["DISPATCHER"]);
      if (route.path.startsWith("/api/sync/") || route.path.startsWith("/api/field/"))
        expect(route.roles).toEqual(["LOADER", "DRIVER"]);
    },
  );

  it("describes public operations, SSE and binary uploads explicitly", () => {
    expect(apiRoutes.health.access).toBe("public");
    expect(apiRoutes.ready.access).toBe("public");
    expect(apiRoutes.login.access).toBe("public");
    expect(apiRoutes.stream.transport).toBe("sse");
    expect(apiRoutes.uploadBlob.transport).toBe("binary");
    expect(apiRoutes.demoReset.access).toBe("demo");
    expect(blobBodySchema.safeParse(new Uint8Array(0)).success).toBe(false);
    expect(blobBodySchema.safeParse(new Uint8Array(524289)).success).toBe(false);
    expect(blobBodySchema.safeParse("image data").success).toBe(false);
  });

  it("supports every role's credentials and rejects mixed credential shapes", () => {
    const deviceId = apiFixtures.idParams.id;
    for (const login of [
      { role: "STORE", loginId: "store@example.com", password: "secret" },
      { role: "DISPATCHER", email: "dispatch@example.com", password: "secret", depot: "Kandy" },
      { role: "LOADER", loginId: "LDR001", pin: "1234", deviceId },
      { role: "DRIVER", loginId: "DRV001", pin: "1234", deviceId },
    ])
      expect(loginRequestSchema.parse(login)).toEqual(login);
    expect(
      loginRequestSchema.safeParse({ role: "DRIVER", loginId: "DRV001", password: "secret", deviceId }).success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ role: "DISPATCHER", email: "dispatch@example.com", password: "secret" }).success,
    ).toBe(false);
  });

  it("replaces loader and driver snapshots without losing scope data or config", () => {
    const loader = apiFixtures.fieldSnapshot;
    const driver = {
      ...loader,
      role: "DRIVER",
      scope: { date: loader.scope.date, vehicle: apiFixtures.vehicle, trips: loader.scope.trips },
    };
    expect(fieldSnapshotSchema.parse(driver)).toEqual(driver);
    expect(
      fieldSnapshotSchema.parse({ ...loader, planVersion: null, scope: { ...loader.scope, trips: [] } }).planVersion,
    ).toBeNull();
    expect(fieldSnapshotSchema.safeParse({ ...driver, scope: loader.scope }).success).toBe(false);
    const { config: _config, ...withoutConfig } = driver;
    expect(fieldSnapshotSchema.safeParse(withoutConfig).success).toBe(false);
    const { planVersion: _planVersion, ...withoutVersion } = loader;
    expect(fieldSnapshotSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it("uses the shared validation shape in both validate and publish 422 responses", () => {
    expect(apiRoutes.validate.responses[422]).toBe("validationErrorResponse");
    expect(apiRoutes.publish.responses[422]).toBe("validationErrorResponse");
    expect(
      validationErrorResponseSchema.parse(apiFixtures.validationErrorResponse).validation.violations[0]?.params,
    ).toEqual({ limit: 5000000, actual: 5000001 });
    expect(validationErrorResponseSchema.safeParse(apiFixtures.apiError).success).toBe(false);
  });

  it("handles read-all and explicit notification IDs separately", () => {
    expect(readNotificationsRequestSchema.parse({ all: true })).toEqual({ all: true });
    expect(readNotificationsRequestSchema.safeParse({ all: false, ids: [] }).success).toBe(false);
  });

  it("requires field idempotency metadata and correlated payloads", () => {
    const event = apiFixtures.clientEvent;
    const { clientEventId: _id, ...withoutId } = event;
    expect(clientEventSchema.safeParse(withoutId).success).toBe(false);
    expect(clientEventSchema.safeParse({ ...event, payload: { tripId: apiFixtures.trip.id } }).success).toBe(false);
    expect(clientEventSchema.safeParse({ ...event, capturedAt: "2026-02-30T05:00:00.000Z" }).success).toBe(false);
  });

  it("matches existing readiness producers for success and failure", () => {
    expect(readyResponseSchema.parse({ status: "ok", checks: { database: "ok", migrations: "ok" } })).toEqual({
      status: "ok",
      checks: { database: "ok", migrations: "ok" },
    });
    expect(notReadyResponseSchema.parse({ status: "unavailable", checks: { database: "failed" } })).toEqual({
      status: "unavailable",
      checks: { database: "failed" },
    });
  });
});
