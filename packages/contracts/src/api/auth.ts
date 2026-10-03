import { z } from "zod";
import { isoDateTime, uuidV7 } from "../primitives";
import { humanRoleSchema, nonempty } from "./common";

export const loginRequestSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("STORE"),
    loginId: z.union([z.string().regex(/^OUT\d{3}$/), z.email()]),
    password: nonempty,
  }),
  z.strictObject({ role: z.literal("DISPATCHER"), email: z.email(), password: nonempty, depot: nonempty }),
  z.strictObject({
    role: z.literal("LOADER"),
    loginId: z.string().regex(/^LDR\d{3}$/),
    pin: z.string().regex(/^\d+$/),
    deviceId: uuidV7,
  }),
  z.strictObject({
    role: z.literal("DRIVER"),
    loginId: z.string().regex(/^DRV\d{3}$/),
    pin: z.string().regex(/^\d+$/),
    deviceId: uuidV7,
  }),
]);
export const sessionUserSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("STORE"), id: nonempty, displayName: nonempty, locale: nonempty, outletId: uuidV7 }),
  z.strictObject({
    role: z.literal("DISPATCHER"),
    id: nonempty,
    displayName: nonempty,
    locale: nonempty,
    depots: z.array(nonempty).min(1),
  }),
  z.strictObject({ role: z.literal("LOADER"), id: nonempty, displayName: nonempty, locale: nonempty, depot: nonempty }),
  z.strictObject({
    role: z.literal("DRIVER"),
    id: nonempty,
    displayName: nonempty,
    locale: nonempty,
    vehicleId: uuidV7,
  }),
]);
export const sessionResponseSchema = z.strictObject({
  user: sessionUserSchema,
  expiresAt: isoDateTime,
  serverTime: isoDateTime,
  csrfToken: nonempty,
});
export const reauthRequestSchema = z.strictObject({
  role: humanRoleSchema.extract(["LOADER", "DRIVER"]),
  pin: z.string().regex(/^\d+$/),
  deviceId: uuidV7,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export const authSchemas = {
  loginRequest: loginRequestSchema,
  sessionUser: sessionUserSchema,
  sessionResponse: sessionResponseSchema,
  reauthRequest: reauthRequestSchema,
};
