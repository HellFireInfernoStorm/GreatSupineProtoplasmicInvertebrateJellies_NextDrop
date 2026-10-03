import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { DEMO_SCRIPT_KEY_HEADER } from "@nextdrop/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actors, expectedRoles, matrix, resources, routes } from "../../../tests/support/authorization-cases";
import { registerErrorHandling } from "../../lib/errors";
import { can } from "../policy";
import { buildServer } from "../../server";
import { authConfigFromEnv } from "./config";
import { csrfToken, CSRF_HEADER } from "./csrf";
import { assertRoutePolicy, installGuard, SESSION_COOKIE } from "./guard";
import type { SessionRecord, Sessions } from "./sessions";

const config = authConfigFromEnv({
  SESSION_SECRET: "matrix-secret-matrix-secret-matrix",
  DEMO_MODE: "true",
  DEMO_SCRIPT_KEY: "matrix-script-key",
});
const now = new Date("2026-10-03T00:00:00Z");
const app = Fastify();

// Session storage and actor construction are substituted. The production cookie parser, guard hooks, CSRF,
// registration check, resolver invocation and can() all run. PostgreSQL filtering is tested separately.
const records = actors.map(
  (actor, index) =>
    ({
      id: `018f0000-0000-7000-8000-00000000000${index + 1}`,
      kind: actor.role === "LOADER" || actor.role === "DRIVER" ? "FIELD" : "WEB",
      expiresAt: new Date(now.getTime() + 60_000),
      deviceId: null,
      user: { role: actor.role },
    }) as SessionRecord,
);
const sessions = {
  find: async (id: string) => records.find((record) => record.id === id) ?? null,
  actorFor: async (user: SessionRecord["user"], id: string) => ({
    ...actors.find((actor) => actor.role === user.role)!,
    sessionId: id,
  }),
  slide: async (record: SessionRecord) => record,
  remove: async () => {
    throw new Error("Unexpected session removal");
  },
  reauthDeadline: () => now.getTime() + 86_400_000,
} as unknown as Sessions;

beforeAll(async () => {
  await app.register(cookie, { secret: config.sessionSecret });
  registerErrorHandling(app);
  installGuard(app, { sessions, config, now: () => now, setSessionCookie: () => {}, clearSessionCookie: () => {} });
  for (const [action, route] of routes) {
    app.route({
      method: route.method,
      url: route.path,
      config: {
        policy: {
          action,
          resourceResolver: (request) => resources[Number(request.headers["x-matrix-resource"])]!.resource,
        },
      },
      handler: async () => ({ reachedHandler: true }),
    });
  }
  await app.ready();
});
afterAll(async () => app.close());

describe("generated contract authorization matrix", () => {
  it.each(routes)("%s retains its reviewed role ceiling", (action, route) => {
    expect([...route.roles].sort()).toEqual([...expectedRoles[action]].sort());
  });

  it.each(matrix)("$action / $actor.role / $name (policy)", ({ action, actor, resource, allowed }) => {
    expect(can(actor, action, resource)).toBe(allowed);
  });

  // Ownership is action-independent after the role ceiling. Keep every route/role HTTP check,
  // and exercise every ownership scenario through the all-role notifications action once.
  const httpCases = matrix.filter(
    ({ action, name }) => name === "self" || (action === "notifications" && name !== "self"),
  );
  it.each(httpCases)("$action / $actor.role / $name (HTTP)", async ({ route, actor, resource, allowed }) => {
    const record = records[actors.indexOf(actor)]!;
    const response = await app.inject({
      method: route.method,
      url: route.path.replace(/:[^/]+/g, "subject"),
      cookies: { [SESSION_COOKIE]: app.signCookie(record.id) },
      headers: {
        [CSRF_HEADER]: csrfToken(config.sessionSecret, record.id),
        "x-matrix-resource": String(resources.findIndex((item) => item.resource === resource)),
      },
    });
    expect(response.statusCode).toBe(route.access === "public" || allowed ? 200 : 403);
    if (response.statusCode === 403) expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    else expect(response.json()).toEqual({ reachedHandler: true });
  });

  it.each(routes)("%s requires a session except public and script-key demo access", async (_action, route) => {
    const response = await app.inject({
      method: route.method,
      url: route.path.replace(/:[^/]+/g, "subject"),
      headers: { [CSRF_HEADER]: "present", "x-matrix-resource": "0" },
    });
    expect(response.statusCode).toBe(route.access === "public" ? 200 : 401);
    if (route.access === "demo") {
      const script = await app.inject({
        method: route.method,
        url: route.path,
        headers: { [DEMO_SCRIPT_KEY_HEADER]: config.demoScriptKey },
      });
      expect(script.statusCode).toBe(200);
      const wrongKey = await app.inject({
        method: route.method,
        url: route.path,
        headers: { [DEMO_SCRIPT_KEY_HEADER]: "wrong-key" },
      });
      expect(wrongKey.statusCode).toBe(401);
    }
  });

  it.each(routes)("%s cannot be registered without a matching policy", (action, route) => {
    expect(() => assertRoutePolicy({ method: route.method, url: route.path, config: {} })).toThrow(
      /declares no policy/,
    );
    expect(() =>
      assertRoutePolicy({
        method: route.method,
        url: route.path,
        config: { policy: { action, resourceResolver: undefined } as never },
      }),
    ).toThrow(/resourceResolver/);
    expect(() =>
      assertRoutePolicy({
        method: route.method,
        url: route.path + "/unguarded",
        config: { policy: { action, resourceResolver: () => ({ kind: "self" }) } },
      }),
    ).toThrow(/does not match/);
  });

  it.each(routes.filter(([, route]) => route.method !== "GET"))(
    "%s rejects a mutation without CSRF",
    async (_action, route) => {
      // Public mutations need a nonempty header even without a session/role ceiling.
      const actor =
        route.access === "public" ? actors[0]! : actors.find((candidate) => route.roles.includes(candidate.role));
      if (!actor) throw new Error("Session mutation has no permitted role");
      const record = records[actors.indexOf(actor)]!;
      const response = await app.inject({
        method: route.method,
        url: route.path.replace(/:[^/]+/g, "subject"),
        cookies: { [SESSION_COOKIE]: app.signCookie(record.id) },
        headers: { "x-matrix-resource": "0" },
      });
      expect(response.statusCode).toBe(403);
    },
  );

  it("audits actual server registration and rejects a new route without policy", async () => {
    const server = await buildServer(
      {},
      { ready: async () => ({ status: "ok", checks: { database: "ok", migrations: "ok" } }) },
    );
    try {
      expect(() => server.get("/api/unguarded-future-route", async () => ({ leaked: true }))).toThrow(
        /declares no policy/,
      );
      await server.ready();
    } finally {
      await server.close();
    }
  });
});
