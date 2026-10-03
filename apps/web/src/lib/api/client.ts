import { apiRoutes, apiSchemas, type ApiRouteDefinition, type ApiSchemaName } from "@nextdrop/contracts";
import { observeServerTime } from "../clock";
import { ApiRequestError } from "./errors";
import type { ApiRequest, ApiResponse, JsonRouteName, RawResponse, Transport, TransportRequest } from "./types";

// The one typed HTTP client (spec/platform/api-dtos.md). Routes, paths and DTOs come from packages/contracts, so a
// screen calls `callApi("storeOrders", { query })` and gets the contract's response type back.

/** True when the build answers from the contract fixtures instead of the network (VITE_API_MOCK=true). */
export const API_MOCK = import.meta.env.VITE_API_MOCK === "true";

const CSRF_HEADER = "x-nextdrop-csrf";
/** Mutations need the custom header even before a session exists (login). Any non-empty value passes then. */
const CSRF_BEFORE_SESSION = "1";

let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;
let transportOverride: Transport | null = null;

/** Session responses supply the token for later mutations. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called when a route that needs a live session answers 401. The session module decides what that means per role. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/** Binary transports share the same session-expiry behavior as JSON routes. */
export function notifySessionExpired(): void {
  onUnauthenticated?.();
}

/** Tests replace the transport. Pass null to restore the default. */
export function setTransport(transport: Transport | null): void {
  transportOverride = transport;
}

const fetchTransport: Transport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    credentials: "same-origin",
    signal: request.signal,
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
};

async function resolveTransport(): Promise<Transport> {
  if (transportOverride) return transportOverride;
  // The mock and its fixtures are a separate chunk, loaded only in a mock build.
  if (API_MOCK) return (await import("./mock")).mockTransport;
  return fetchTransport;
}

function buildUrl(definition: ApiRouteDefinition, params: unknown, query: unknown): string {
  const values = (params ?? {}) as Record<string, unknown>;
  const path = definition.path.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new ApiRequestError("invalid", null, null, `Missing path parameter "${key}"`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function parsePart(schemaName: ApiSchemaName | undefined, value: unknown, part: string): unknown {
  if (!schemaName) return undefined;
  const parsed = apiSchemas[schemaName].safeParse(value);
  if (!parsed.success) {
    throw new ApiRequestError("invalid", null, null, `Request ${part} does not match ${schemaName}`);
  }
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type RequiredKeys<T> = { [P in keyof T]-?: undefined extends T[P] ? never : P }[keyof T];

/** The request argument is optional for a route that takes no params, query or body. */
type RequestArgs<K extends JsonRouteName> = [RequiredKeys<ApiRequest<K>>] extends [never]
  ? [request?: ApiRequest<K>]
  : [request: ApiRequest<K>];

/** Call one route by its name in the contract route table. Rejects with ApiRequestError. */
export async function callApi<K extends JsonRouteName>(name: K, ...args: RequestArgs<K>): Promise<ApiResponse<K>> {
  const definition: ApiRouteDefinition = apiRoutes[name];
  const request = (args[0] ?? {}) as {
    params?: unknown;
    query?: unknown;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  };

  const body = parsePart(definition.request.body, request.body, "body");
  parsePart(definition.request.params, request.params, "params");
  parsePart(definition.request.query, request.query, "query");
  const headers: Record<string, string> = { accept: "application/json", ...request.headers };
  if (body !== undefined) headers["content-type"] = "application/json";
  // A route that declares request headers is a mutation and carries the CSRF header.
  if (definition.request.headers) headers[CSRF_HEADER] = csrfToken ?? CSRF_BEFORE_SESSION;
  // Catches a missing required header, such as the idempotency-key of an order, before the request leaves.
  parsePart(definition.request.headers, headers, "headers");

  const transportRequest: TransportRequest = {
    name,
    method: definition.method,
    url: buildUrl(definition, request.params, request.query),
    headers,
    body,
    signal: request.signal,
  };

  let raw: RawResponse;
  try {
    raw = await (await resolveTransport())(transportRequest);
  } catch (cause) {
    if (cause instanceof ApiRequestError) throw cause;
    throw new ApiRequestError("network", null, null, cause instanceof Error ? cause.message : "Network error");
  }

  if (raw.status >= 200 && raw.status < 300) {
    const schemaName = (definition.responses as Record<number, ApiSchemaName | undefined>)[raw.status];
    const parsed = schemaName ? apiSchemas[schemaName].safeParse(raw.body) : null;
    if (!parsed?.success) {
      throw new ApiRequestError("invalid", raw.status, null, `Response of ${name} does not match the contract`);
    }
    const data: unknown = parsed.data;
    if (isRecord(data) && typeof data.serverTime === "string") observeServerTime(data.serverTime);
    return data as ApiResponse<K>;
  }

  const error = apiSchemas.apiError.safeParse(raw.body);
  // A 401 from login is a wrong password and from reauth a wrong PIN: neither says the session is gone.
  if (raw.status === 401 && (definition.access === "session" || definition.access === "demo")) notifySessionExpired();
  throw new ApiRequestError(
    "http",
    raw.status,
    error.success ? error.data : null,
    `${name} failed with status ${raw.status}`,
  );
}
