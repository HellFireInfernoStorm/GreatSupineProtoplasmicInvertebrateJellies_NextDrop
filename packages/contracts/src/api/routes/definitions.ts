import type { HumanRole } from "../common";
import type { ApiSchemaName } from "../schemas";

export interface ApiRouteDefinition {
  method: "GET" | "POST" | "PUT";
  path: `/api/${string}`;
  roles: readonly HumanRole[];
  access: "public" | "session" | "expired-session" | "demo";
  transport: "json" | "binary" | "sse";
  /** Complete client DTO when server ingress deliberately defers validation to individual items. */
  clientBody?: ApiSchemaName;
  /** Serialized bytes; enforced by the HTTP transport, independently of DTO validation. */
  bodyLimit?: number;
  request: Partial<Record<"params" | "query" | "headers" | "body", ApiSchemaName>>;
  responses: Readonly<Record<number, ApiSchemaName>>;
}
/** Apply these JSON error contracts in the central API layer before route-specific overrides. */
export const apiCommonErrorResponses = {
  400: "apiError",
  401: "apiError",
  403: "apiError",
  429: "apiError",
  500: "apiError",
} as const;
/** Demo access means DEMO_MODE plus dispatcher session or this script-key header. */
export const DEMO_SCRIPT_KEY_HEADER = "x-nextdrop-script-key";
