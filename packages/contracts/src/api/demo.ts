import { z } from "zod";
import { isoDateTime } from "../primitives";
import { count, humanRoleSchema } from "./common";

export const demoPresetSchema = z.enum([
  "before-cutoff",
  "orders-closed",
  "plan-published",
  "loading",
  "mid-run",
  "clash-ready",
]);
export const demoStateSchema = z.strictObject({
  enabled: z.literal(true),
  serverTime: isoDateTime,
  clockOffsetMs: z.number().int(),
  preset: demoPresetSchema,
  resetEpoch: count,
  lastResetBy: humanRoleSchema.nullable(),
  lastResetAt: isoDateTime.nullable(),
});
export const demoClockRequestSchema = z.strictObject({ serverTime: isoDateTime });
export const demoResetRequestSchema = z.strictObject({ preset: demoPresetSchema });
export const demoTickResponseSchema = z.strictObject({ transitionsApplied: count, serverTime: isoDateTime });
export const demoSchemas = {
  demoPreset: demoPresetSchema,
  demoState: demoStateSchema,
  demoClockRequest: demoClockRequestSchema,
  demoResetRequest: demoResetRequestSchema,
  demoTickResponse: demoTickResponseSchema,
};
