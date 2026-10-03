import { z } from "zod";
import { isoDateTime, uuidV7 } from "../primitives";
import { count, nonempty, paramsSchema } from "./common";

export const notificationSchema = z.strictObject({
  id: uuidV7,
  kind: nonempty,
  titleKey: nonempty,
  params: paramsSchema,
  entityRef: z.strictObject({ type: nonempty, id: nonempty }),
  createdAt: isoDateTime,
  readAt: isoDateTime.nullable(),
  group: z.enum(["DELIVERIES", "PLANNING", "NEEDS_ACTION"]),
});
export const notificationsQuerySchema = z.strictObject({
  unreadOnly: z.enum(["true", "false"]).optional(),
  after: nonempty.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const notificationsResponseSchema = z.strictObject({
  items: z.array(notificationSchema),
  unreadCount: count,
  nextCursor: nonempty.nullable(),
});
export const readNotificationsRequestSchema = z.discriminatedUnion("all", [
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({ all: z.literal(false), ids: z.array(uuidV7).min(1) }),
]);
export const readNotificationsResponseSchema = z.strictObject({ updatedCount: count, readAt: isoDateTime });
export const notificationSchemas = {
  notification: notificationSchema,
  notificationsQuery: notificationsQuerySchema,
  notificationsResponse: notificationsResponseSchema,
  readNotificationsRequest: readNotificationsRequestSchema,
  readNotificationsResponse: readNotificationsResponseSchema,
};
