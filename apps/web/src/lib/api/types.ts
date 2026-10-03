import type { ApiDto, ApiDtoInput, ApiRouteName, ApiSchemaName, apiRoutes } from "@nextdrop/contracts";

// Request and response types for every route, derived from the contract route table (spec/platform/api-dtos.md).

type Routes = typeof apiRoutes;

/** Routes the JSON client can call. Blob upload and the SSE hint have their own transports. */
export type JsonRouteName = {
  [K in ApiRouteName]: Routes[K]["transport"] extends "json" ? K : never;
}[ApiRouteName];

type RequestPart<K extends ApiRouteName, P extends "params" | "query" | "body"> =
  Routes[K]["request"] extends Record<P, infer S extends ApiSchemaName>
    ? { [Q in P]: ApiDtoInput<S> }
    : { [Q in P]?: undefined };

export interface RequestOptions {
  /** Extra headers, for example the idempotency-key of an order. The CSRF header is added by the client. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type ApiRequest<K extends ApiRouteName> = RequestPart<K, "params"> &
  RequestPart<K, "query"> &
  RequestPart<K, "body"> &
  RequestOptions;

type SuccessSchema<K extends ApiRouteName> = {
  [S in keyof Routes[K]["responses"]]: S extends 200 | 201 | 202 ? Routes[K]["responses"][S] : never;
}[keyof Routes[K]["responses"]];

export type ApiResponse<K extends ApiRouteName> =
  SuccessSchema<K> extends infer S extends ApiSchemaName ? ApiDto<S> : never;

/** What a transport returns: the HTTP status and the decoded JSON body, if any. */
export interface RawResponse {
  status: number;
  body: unknown;
}

/** The loosely typed request a transport receives after the client has validated it. */
export interface TransportRequest {
  name: ApiRouteName;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}

export type Transport = (request: TransportRequest) => Promise<RawResponse>;
