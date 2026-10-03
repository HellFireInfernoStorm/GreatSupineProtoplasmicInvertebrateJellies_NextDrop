import { z } from "zod";

/** API and sync rejection codes (spec/sync/push-protocol.md, spec/planning/publish-transaction.md). */
export const ERROR_CODES = [
  "MISSING_DEFERRAL_REASON",
  "STOP_LOCKED",
  "ORDER_ALREADY_LOADED",
  "SCHEMA_INVALID",
  "FORBIDDEN",
  "NOT_ASSIGNED",
  "DUPLICATE",
  "ILLEGAL_TRANSITION",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "NOT_FOUND",
  "REVISION_CONFLICT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);
