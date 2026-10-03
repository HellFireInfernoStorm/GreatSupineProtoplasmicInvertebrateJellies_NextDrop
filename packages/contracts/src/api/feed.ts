import { z } from "zod";
import { feedKindSchema } from "../feed";
import { isoDateTime } from "../primitives";
import { count, cursorSchema, nonempty } from "./common";

export const changesQuerySchema = z.strictObject({
  after: cursorSchema,
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export const feedItemSchema = z.strictObject({
  seq: cursorSchema,
  kind: feedKindSchema,
  entity: z.strictObject({ type: nonempty, id: nonempty }),
  version: count.optional(),
  at: isoDateTime,
});
export const changesResponseSchema = z.strictObject({
  items: z.array(feedItemSchema),
  head: cursorSchema,
  resetEpoch: count,
});
export const streamQuerySchema = z.strictObject({ after: cursorSchema });
export const streamHintSchema = z.strictObject({ head: cursorSchema, resetEpoch: count });
export const feedSchemas = {
  changesQuery: changesQuerySchema,
  feedItem: feedItemSchema,
  changesResponse: changesResponseSchema,
  streamQuery: streamQuerySchema,
  streamHint: streamHintSchema,
};
