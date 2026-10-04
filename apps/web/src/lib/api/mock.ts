import {
  apiRouteFixtures,
  apiVariantFixtures,
  HUMAN_ROLES,
  syncEventsRequestSchema,
  reauthRequestSchema,
  loginRequestSchema,
  type ApiDtoInput,
  type ApiRouteName,
  type HumanRole,
} from "@nextdrop/contracts";
import { isFieldRole } from "../fieldRoles";
import { mockDeliveriesRespond } from "./mockDeliveries";
import { mockDispatchRespond } from "./mockDispatch";
import { mockStoreRespond } from "./mockStore";
import { readStored, writeStored } from "../storage";
import type { RawResponse, Transport } from "./types";

// Mock mode (VITE_API_MOCK=true): every route answers from the contract fixtures, so a screen can be built before
// its endpoint exists. Auth is the one stateful part: it keeps a mock session for this tab.
//
// To see the login error states, sign in with the password or PIN below.
export const MOCK_WRONG_SECRETS = ["wrong", "0000"];
export const MOCK_LOCKED_SECRETS = ["locked", "9999"];

const SESSION_KEY = "nextdrop.mock.role";
const WEB_SESSION_MS = 12 * 60 * 60 * 1000;
const FIELD_SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const LATENCY_MS = 120;

const routeFixtures: Record<string, { responses: Record<number, unknown> }> = apiRouteFixtures;

function isRole(value: string | null): value is HumanRole {
  return HUMAN_ROLES.some((role) => role === value);
}

function session(role: HumanRole, nowMs: number): ApiDtoInput<"sessionResponse"> {
  const lifetime = isFieldRole(role) ? FIELD_SESSION_MS : WEB_SESSION_MS;
  return {
    user: apiVariantFixtures.sessionUser[role],
    expiresAt: new Date(nowMs + lifetime).toISOString(),
    serverTime: new Date(nowMs).toISOString(),
    csrfToken: "mock-csrf-token",
  };
}

function unauthenticated(): RawResponse {
  const body: ApiDtoInput<"apiError"> = {
    code: "UNAUTHENTICATED",
    message_key: "errors.unauthenticated",
    params: {},
    requestId: "mock-request",
  };
  return { status: 401, body };
}

function login(body: unknown, nowMs: number): RawResponse {
  const fixtures = apiRouteFixtures.login.responses;
  const request = loginRequestSchema.safeParse(body);
  if (!request.success) return { status: 401, body: fixtures[401] };
  const secret = "pin" in request.data ? request.data.pin : request.data.password;
  if (MOCK_WRONG_SECRETS.includes(secret)) return { status: 401, body: fixtures[401] };
  if (MOCK_LOCKED_SECRETS.includes(secret)) return { status: 429, body: fixtures[429] };
  writeStored(SESSION_KEY, request.data.role, "session");
  return { status: 200, body: session(request.data.role, nowMs) };
}

/** The fixture of the route's success status, with serverTime moved to now so the clock offset stays near zero. */
function fixture(name: ApiRouteName, nowMs: number): RawResponse {
  const responses = routeFixtures[name]?.responses ?? {};
  const status = Object.keys(responses)
    .map(Number)
    .sort((a, b) => a - b)
    .find((code) => code >= 200 && code < 300);
  if (status === undefined) return { status: 500, body: undefined };
  const body = responses[status];
  if (typeof body === "object" && body !== null && "serverTime" in body) {
    return { status, body: { ...body, serverTime: new Date(nowMs).toISOString() } };
  }
  return { status, body };
}

export function mockRespond(name: ApiRouteName, body: unknown, nowMs: number = Date.now()): RawResponse {
  const role = readStored(SESSION_KEY, "session");
  switch (name) {
    case "login":
      return login(body, nowMs);
    case "snapshot":
      if (role === "LOADER" || role === "DRIVER")
        return {
          status: 200,
          body: { ...apiVariantFixtures.fieldSnapshot[role], serverTime: new Date(nowMs).toISOString() },
        };
      return fixture(name, nowMs);
    case "syncEvents": {
      const parsed = syncEventsRequestSchema.safeParse(body);
      if (!parsed.success) return fixture(name, nowMs);
      const template = apiRouteFixtures.syncEvents.responses[200];
      return {
        status: 200,
        body: {
          ...template,
          serverTime: new Date(nowMs).toISOString(),
          results: parsed.data.events.map((event) => ({
            clientEventId: event.clientEventId,
            status: "ACCEPTED",
            serverEventId: event.clientEventId,
            receivedAt: new Date(nowMs).toISOString(),
          })),
        },
      };
    }
    case "reauth": {
      const parsed = reauthRequestSchema.safeParse(body);
      if (parsed.success && MOCK_WRONG_SECRETS.includes(parsed.data.pin))
        return { status: 401, body: apiRouteFixtures.reauth.responses[401] };
      if (parsed.success && MOCK_LOCKED_SECRETS.includes(parsed.data.pin))
        return { status: 429, body: apiRouteFixtures.reauth.responses[429] };
      if (!parsed.success) return unauthenticated();
      const renewedRole = isRole(role) ? role : parsed.data.role;
      if (renewedRole !== parsed.data.role) return unauthenticated();
      writeStored(SESSION_KEY, renewedRole, "session");
      return { status: 200, body: session(renewedRole, nowMs) };
    }
    case "me":
      return isRole(role) ? { status: 200, body: session(role, nowMs) } : unauthenticated();
    case "logout":
      writeStored(SESSION_KEY, null, "session");
      return fixture(name, nowMs);
    default:
      return fixture(name, nowMs);
  }
}

export const mockTransport: Transport = async (request) => {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const nowMs = Date.now();
  return (
    mockDeliveriesRespond(request, nowMs) ??
    mockStoreRespond(request, nowMs) ??
    mockDispatchRespond(request, nowMs) ??
    mockRespond(request.name, request.body)
  );
};
