import { z } from "zod";
import { eventEnvelopeBase } from "../envelope";
import { eventPayloadSchemas, type EventPayloadMap } from "../event-payload";
import { errorCodeSchema } from "../errors";
import { isoDateTime, localDate, uuidV7 } from "../primitives";
import { count, cursorSchema, nonempty } from "./common";
import { rulesConfigSchema } from "./planning-resources";
import { reasonsResponseSchema } from "./reference";
import { tripSchema, vehicleSchema } from "./resources";

export const FIELD_EVENT_TYPES = [
  "PLAN_ACKNOWLEDGED",
  "LOAD_SHORT",
  "LOAD_DAMAGED",
  "LOAD_CONFIRMED",
  "LOAD_REVERSED",
  "TRIP_READY",
  "TRIP_DEPARTED",
  "STOP_ARRIVED",
  "STOP_OUTCOME",
  "POD_CAPTURED",
  "PROBLEM_FLAGGED",
] as const;
export type FieldEventType = (typeof FIELD_EVENT_TYPES)[number];
const clientBase = eventEnvelopeBase
  .omit({ id: true, receivedAt: true, disposition: true })
  .extend({
    clientEventId: uuidV7,
    deviceId: uuidV7,
    deviceSeq: count,
    source: z.literal("FIELD"),
    actor: z.strictObject({ userId: nonempty, role: z.enum(["LOADER", "DRIVER"]) }),
  })
  .strict();
export type ClientEvent = {
  [K in FieldEventType]: z.infer<typeof clientBase> & { type: K; payload: EventPayloadMap[K] };
}[FieldEventType];
const variants = FIELD_EVENT_TYPES.map((type) =>
  clientBase.extend({ type: z.literal(type), payload: eventPayloadSchemas[type] }),
);
// The mapped union keeps type/payload correlation for consumers as well as at runtime.
export const clientEventSchema = z.discriminatedUnion(
  "type",
  variants as [(typeof variants)[number], ...(typeof variants)[number][]],
) as z.ZodType<ClientEvent, ClientEvent>;
export const syncEventsRequestSchema = z
  .strictObject({ deviceId: uuidV7, events: z.array(clientEventSchema).max(100) })
  .refine((body) => body.events.every((event) => event.deviceId === body.deviceId), {
    message: "event deviceId must match batch deviceId",
  });
/** Validate batch framing first; the ingest handler validates each unknown event independently. */
export const syncEventsIngressRequestSchema = z.strictObject({
  deviceId: uuidV7,
  events: z.array(z.unknown()).max(100),
});
const resultBase = z.strictObject({ clientEventId: uuidV7, receivedAt: isoDateTime });
export const syncEventResultSchema = z.discriminatedUnion("status", [
  resultBase.extend({ status: z.literal("ACCEPTED"), serverEventId: uuidV7, code: errorCodeSchema.optional() }),
  resultBase.extend({
    status: z.literal("DUPLICATE"),
    serverEventId: uuidV7.optional(),
    code: errorCodeSchema.optional(),
  }),
  resultBase.extend({
    status: z.literal("HELD_CONFLICT"),
    conflictId: uuidV7,
    serverEventId: uuidV7.optional(),
    code: errorCodeSchema.optional(),
  }),
  resultBase.extend({ status: z.literal("REJECTED"), code: errorCodeSchema }),
]);
export type SyncEventResult = z.infer<typeof syncEventResultSchema>;
export const syncEventsResponseSchema = z.strictObject({
  results: z.array(syncEventResultSchema),
  serverTime: isoDateTime,
  feedHead: cursorSchema,
});
export const snapshotConfigSchema = z.strictObject({
  rules: rulesConfigSchema,
  reasons: reasonsResponseSchema,
  noSignalAfterMin: count,
  lateGraceMin: count,
});
const snapshotBase = z.strictObject({
  planVersion: count.nullable(),
  serverTime: isoDateTime,
  feedCursor: cursorSchema,
  resetEpoch: count,
  config: snapshotConfigSchema,
});
export const fieldSnapshotSchema = z.discriminatedUnion("role", [
  snapshotBase.extend({
    role: z.literal("LOADER"),
    scope: z.strictObject({ depot: nonempty, date: localDate, trips: z.array(tripSchema) }),
  }),
  snapshotBase.extend({
    role: z.literal("DRIVER"),
    scope: z.strictObject({ date: localDate, vehicle: vehicleSchema, trips: z.array(tripSchema) }),
  }),
]);
export type FieldSnapshot = z.infer<typeof fieldSnapshotSchema>;
export const heartbeatRequestSchema = z.strictObject({
  deviceId: uuidV7,
  appVersion: nonempty,
  pendingCount: count,
  lastSyncAt: isoDateTime.nullable(),
  lastKnownStop: uuidV7.nullable(),
});
export const heartbeatResponseSchema = z.strictObject({
  serverTime: isoDateTime,
  feedHead: cursorSchema,
  resetEpoch: count,
});
export const blobHeadersSchema = z.object({
  "content-type": z.enum(["image/jpeg", "image/png", "image/webp"]),
  "x-nextdrop-csrf": nonempty,
});
// Bytes are a transport body, not JSON. The handler also limits raw upload bytes.
export const blobBodySchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 204800, {
    message: "blob must contain 1..204800 bytes",
  });
export const blobResponseSchema = z.strictObject({
  clientBlobId: uuidV7,
  mime: blobHeadersSchema.shape["content-type"],
  size: z.number().int().positive().max(204800),
});
export const fieldSchemas = {
  clientEvent: clientEventSchema,
  syncEventsRequest: syncEventsRequestSchema,
  syncEventsIngressRequest: syncEventsIngressRequestSchema,
  syncEventResult: syncEventResultSchema,
  syncEventsResponse: syncEventsResponseSchema,
  snapshotConfig: snapshotConfigSchema,
  fieldSnapshot: fieldSnapshotSchema,
  heartbeatRequest: heartbeatRequestSchema,
  heartbeatResponse: heartbeatResponseSchema,
  blobHeaders: blobHeadersSchema,
  blobBody: blobBodySchema,
  blobResponse: blobResponseSchema,
};
