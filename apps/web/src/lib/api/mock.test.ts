import {
  apiFixtures,
  apiRoutes,
  apiSchemas,
  apiVariantFixtures,
  HUMAN_ROLES,
  type ApiRouteName,
} from "@nextdrop/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockRespond } from "./mock";
import { mockDispatchRespond } from "./mockDispatch";
import { mockStoreRespond } from "./mockStore";
import { buildOutlook } from "../../roles/dispatcher/outlook-model";

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

it("renews a cold field session using its request role and remembers the renewed session", () => {
  const request = { ...apiFixtures.reauthRequest, role: "DRIVER", pin: "1234" };
  expect(mockRespond("reauth", { ...request, pin: "0000" }).status).toBe(401);
  expect(mockRespond("reauth", { ...request, pin: "9999" }).status).toBe(429);
  expect(mockRespond("me", undefined).status).toBe(401);
  expect(mockRespond("reauth", request).status).toBe(200);
  expect(apiSchemas.sessionResponse.parse(mockRespond("me", undefined).body).user.role).toBe("DRIVER");
  expect(mockRespond("reauth", { ...request, role: "LOADER" }).status).toBe(401);
});

it("gives the D5 outlook seven flagged weeks with one over capacity and tight payday weeks", () => {
  const now = Date.parse("2026-10-04T12:00:00.000Z");
  const request = (name: ApiRouteName, url: string) => ({ name, url, body: undefined, headers: {} });
  const outlook = mockDispatchRespond(
    request("outlook", "/api/dispatch/outlook?depot=Peliyagoda&from=2026-10-05&weeks=7"),
    now,
  )!;
  const calendar = mockStoreRespond(request("calendar", "/api/reference/calendar?from=2026-10-05&to=2026-11-22"), now)!;
  const model = buildOutlook(
    "2026-10-05",
    apiSchemas.outlookResponse.parse(outlook.body).items,
    apiSchemas.calendarResponse.parse(calendar.body).items,
  )!;
  expect(model.weeks.map((week) => week.isoWeek)).toEqual([41, 42, 43, 44, 45, 46, 47]);
  expect(model.peak).toMatchObject({ isoWeek: 45, level: "over", chilledLevel: "over" });
  expect(model.peak.festival).toEqual({ name: "deepavali", date: "2026-11-08" });
  expect(model.paydayWeeks.map((week) => [week.isoWeek, week.level])).toEqual([
    [43, "tight"],
    [44, "tight"],
  ]);
});
