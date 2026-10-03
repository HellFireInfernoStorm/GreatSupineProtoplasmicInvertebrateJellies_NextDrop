import { z } from "zod";
export const healthResponseSchema = z.strictObject({ status: z.literal("ok") });
export const readyResponseSchema = z.strictObject({
  status: z.literal("ok"),
  checks: z.record(z.string(), z.enum(["ok", "failed"])),
});
export const notReadyResponseSchema = z.strictObject({
  status: z.literal("unavailable"),
  checks: z.record(z.string(), z.enum(["ok", "failed"])),
});
export const opsSchemas = {
  healthResponse: healthResponseSchema,
  readyResponse: readyResponseSchema,
  notReadyResponse: notReadyResponseSchema,
};
