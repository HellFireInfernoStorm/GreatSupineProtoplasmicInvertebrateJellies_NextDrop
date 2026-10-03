import type { ApiError, ErrorCode } from "@nextdrop/contracts";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Params = ApiError["params"];

/** A business error that maps to the shared `{ code, message_key, params, requestId }` body. */
export class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    readonly messageKey: string,
    readonly params: Params = {},
    readonly headers: Record<string, string> = {},
    /** Extra body fields a route's contract declares, e.g. `validation` on 422 VALIDATION_FAILED. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(`${code}: ${messageKey}`);
    this.name = "ApiHttpError";
  }
}

export const unauthenticated = (messageKey = "errors.unauthenticated") =>
  new ApiHttpError(401, "UNAUTHENTICATED", messageKey);
export const invalidCredentials = () => new ApiHttpError(401, "INVALID_CREDENTIALS", "errors.invalidCredentials");
export const forbidden = (messageKey = "errors.forbidden") => new ApiHttpError(403, "FORBIDDEN", messageKey);
export const notFound = () => new ApiHttpError(404, "NOT_FOUND", "errors.notFound");
export const rateLimited = (retryAfterMs: number) => {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new ApiHttpError(
    429,
    "RATE_LIMITED",
    "errors.rateLimited",
    { retryAfterSeconds },
    { "retry-after": String(retryAfterSeconds) },
  );
};

function body(request: FastifyRequest, code: ErrorCode, messageKey: string, params: Params = {}): ApiError {
  return { code, message_key: messageKey, params, requestId: request.id };
}

function send(reply: FastifyReply, status: number, payload: ApiError & Record<string, unknown>) {
  return reply.code(status).type("application/json").send(payload);
}

/** Handles an unmatched request itself (returns the reply) or leaves it to the JSON 404 (returns undefined). */
export type NotFoundFallback = (request: FastifyRequest, reply: FastifyReply) => FastifyReply | undefined;

/** One error shape for every route (spec/platform/api.md). Register before any route. */
export function registerErrorHandling(app: FastifyInstance, notFoundFallback?: NotFoundFallback) {
  app.setErrorHandler((error: FastifyError | ApiHttpError, request, reply) => {
    if (error instanceof ApiHttpError) {
      reply.headers(error.headers);
      return send(reply, error.statusCode, {
        ...body(request, error.code, error.messageKey, error.params),
        ...error.extra,
      });
    }
    if (error.validation) return send(reply, 400, body(request, "SCHEMA_INVALID", "errors.schemaInvalid"));
    const status = error.statusCode ?? 500;
    if (status === 413) return send(reply, 413, body(request, "PAYLOAD_TOO_LARGE", "errors.payloadTooLarge"));
    if (status >= 400 && status < 500) return send(reply, status, body(request, "SCHEMA_INVALID", "errors.badRequest"));
    request.log.error({ err: error }, "unhandled error");
    return send(reply, 500, body(request, "INTERNAL_ERROR", "errors.internal"));
  });
  app.setNotFoundHandler(
    (request, reply) =>
      notFoundFallback?.(request, reply) ?? send(reply, 404, body(request, "NOT_FOUND", "errors.notFound")),
  );
}
