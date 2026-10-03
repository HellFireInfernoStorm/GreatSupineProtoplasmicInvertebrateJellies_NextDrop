import { z } from "zod";
import { localDate, isoDateTime, uuidV7 } from "../primitives";
import {
  orderCancelledPayloadSchema,
  receiptConfirmedPayloadSchema,
  issueReportedPayloadSchema,
} from "../payloads/order-lifecycle";
import { orderStatusSchema } from "../vocab";
import { count, nonempty } from "./common";
import { orderSchema, tripSchema } from "./resources";

export const cutoffResponseSchema = z.strictObject({
  serverTime: isoDateTime,
  requestedDate: localDate,
  deliveryDate: localDate,
  cutoffAt: isoDateTime,
  orderingOpen: z.boolean(),
  guidanceKey: nonempty.nullable(),
});
export const deliveriesResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      order: orderSchema,
      trip: tripSchema.nullable(),
      signal: z.enum(["ONLINE", "NO_SIGNAL"]),
      lastHeardAt: isoDateTime.nullable(),
    }),
  ),
  serverTime: isoDateTime,
});
export const createOrderRequestSchema = z.strictObject({
  requestedDate: localDate,
  lines: z.array(z.strictObject({ productId: uuidV7, qty: z.number().int().positive() })).min(1),
  replacesOrderId: uuidV7.optional(),
});
export const orderListQuerySchema = z.strictObject({
  date: localDate.optional(),
  status: orderStatusSchema.optional(),
  after: nonempty.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const ordersResponseSchema = z.strictObject({ items: z.array(orderSchema), nextCursor: nonempty.nullable() });
export const cancelOrderRequestSchema = orderCancelledPayloadSchema;
export const receiptRequestSchema = receiptConfirmedPayloadSchema;
export const reportIssueRequestSchema = issueReportedPayloadSchema;
export const issueCreatedResponseSchema = z.strictObject({ issueId: uuidV7, order: orderSchema });
export const orderHistoryResponseSchema = z.strictObject({ items: z.array(orderSchema), total: count });
export const storeSchemas = {
  cutoffResponse: cutoffResponseSchema,
  deliveriesResponse: deliveriesResponseSchema,
  createOrderRequest: createOrderRequestSchema,
  orderListQuery: orderListQuerySchema,
  ordersResponse: ordersResponseSchema,
  cancelOrderRequest: cancelOrderRequestSchema,
  receiptRequest: receiptRequestSchema,
  reportIssueRequest: reportIssueRequestSchema,
  issueCreatedResponse: issueCreatedResponseSchema,
  orderHistoryResponse: orderHistoryResponseSchema,
};
