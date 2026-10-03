import type { ValidationResult, Violation } from "@nextdrop/rules";
import { z } from "zod";
import { errorCodeSchema } from "../errors";
import { isoDateTime, localDate, uuidV7 } from "../primitives";
import { validatorCodeSchema } from "../vocab";

export const HUMAN_ROLES = ["STORE", "DISPATCHER", "LOADER", "DRIVER"] as const;
export const humanRoleSchema = z.enum(HUMAN_ROLES);
export type HumanRole = z.infer<typeof humanRoleSchema>;
export const nonempty = z.string().min(1);
export const count = z.number().int().nonnegative();
export const minute = count.max(1440);
export const cursorSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const paramsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export const apiErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message_key: nonempty,
  params: paramsSchema,
  requestId: nonempty,
});
export const violationSchema = z.strictObject({
  code: validatorCodeSchema,
  severity: z.enum(["HARD", "WARN"]),
  tripRef: nonempty.optional(),
  vehicleId: nonempty.optional(),
  orderIds: z.array(nonempty).readonly(),
  params: paramsSchema,
  message_key: nonempty,
});
export const validationResultSchema = z.strictObject({
  ok: z.boolean(),
  violations: z.array(violationSchema).readonly(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiViolation = z.infer<typeof violationSchema>;
export type ApiValidationResult = z.infer<typeof validationResultSchema>;

type EqualShape<A, B> = A extends B ? (B extends A ? true : never) : never;
const validationMatchesRules: EqualShape<ApiValidationResult, ValidationResult> = true;
const violationMatchesRules: EqualShape<ApiViolation, Violation> = true;
void validationMatchesRules;
void violationMatchesRules;

export const idParamsSchema = z.strictObject({ id: uuidV7 });
export const dateParamsSchema = z.strictObject({ date: localDate });
export const dateQuerySchema = z.strictObject({ date: localDate });
export const listQuerySchema = z.strictObject({
  after: nonempty.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const mutationHeadersSchema = z.object({ "x-nextdrop-csrf": nonempty });
export const orderCreateHeadersSchema = mutationHeadersSchema.extend({ "idempotency-key": nonempty });
export const ackResponseSchema = z.strictObject({ ok: z.literal(true), serverTime: isoDateTime });
export const commonSchemas = {
  apiError: apiErrorSchema,
  violation: violationSchema,
  validationResult: validationResultSchema,
  idParams: idParamsSchema,
  dateParams: dateParamsSchema,
  dateQuery: dateQuerySchema,
  listQuery: listQuerySchema,
  mutationHeaders: mutationHeadersSchema,
  orderCreateHeaders: orderCreateHeadersSchema,
  ackResponse: ackResponseSchema,
};
