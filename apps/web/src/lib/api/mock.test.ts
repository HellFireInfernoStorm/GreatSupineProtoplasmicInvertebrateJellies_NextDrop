import { apiRoutes, apiSchemas, apiVariantFixtures, HUMAN_ROLES, type ApiRouteName } from "@nextdrop/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockRespond } from "./mock";

/** The mock keeps its session in sessionStorage, which Node does not have. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage: memoryStorage() });
});

describe("mock mode", () => {
  it("signs every role in with a session the contract accepts, and remembers it for /auth/me", () => {
    for (const role of HUMAN_ROLES) {
      const login = mockRespond("login", apiVariantFixtures.loginRequest[role]);
      expect(login.status).toBe(200);
      const session = apiSchemas.sessionResponse.parse(login.body);
      expect(session.user.role).toBe(role);
      expect(apiSchemas.sessionResponse.parse(mockRespond("me", undefined).body).user.role).toBe(role);
    }
  });

  it("answers /auth/me with 401 before sign-in and after sign-out", () => {
    expect(mockRespond("me", undefined).status).toBe(401);
    mockRespond("login", apiVariantFixtures.loginRequest.DRIVER);
    expect(mockRespond("logout", undefined).status).toBe(200);
    const after = mockRespond("me", undefined);
    expect(after.status).toBe(401);
    expect(apiSchemas.apiError.parse(after.body).code).toBe("UNAUTHENTICATED");
  });

  it("lets a developer see the wrong-PIN and locked states", () => {
    const loader = apiVariantFixtures.loginRequest.LOADER;
    expect(mockRespond("login", { ...loader, pin: "0000" }).status).toBe(401);
    expect(mockRespond("login", { ...loader, pin: "9999" }).status).toBe(429);
    expect(mockRespond("me", undefined).status).toBe(401);
  });

  it("answers every route with a success body its own response schema accepts, stamped with the current time", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    for (const name of Object.keys(apiRoutes) as ApiRouteName[]) {
      if (name === "me" || name === "reauth" || name === "login") continue;
      const route = apiRoutes[name];
      if (route.transport !== "json") continue;
      const response = mockRespond(name, undefined, now);
      const schemaName = (route.responses as Record<number, keyof typeof apiSchemas>)[response.status];
      expect(response.status, name).toBeGreaterThanOrEqual(200);
      expect(response.status, name).toBeLessThan(300);
      const parsed = apiSchemas[schemaName!].parse(response.body) as { serverTime?: string };
      if (parsed.serverTime !== undefined) expect(parsed.serverTime, name).toBe("2026-10-03T12:00:00.000Z");
    }
  });
});
