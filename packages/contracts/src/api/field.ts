import { z } from "zod";
import { eventEnvelopeBase, eventEnvelopeSchema } from "../envelope";
import { eventPayloadSchemas, type EventPayloadMap } from "../event-payload";
import { errorCodeSchema } from "../errors";
import { syncResultStatusSchema } from "../sync";
import { SCHEMA_VERSION, schemaVersion } from "../schema-version";
import { conflictKindSchema, conflictResolutionSchema } from "../vocab";
import { upcastPayload, upcasterRegistry, type UpcasterRegistry } from "../upcasters";
import { isoDateTime, localDate, uuidV7 } from "../primitives";
import { count, cursorSchema, nonempty } from "./common";
import { rulesConfigSchema } from "./planning-resources";
import { reasonsResponseSchema } from "./reference";
import { orderSchema, stopSchema, tripSchema, vehicleSchema } from "./resources";

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
  resultBase.extend({
    status: syncResultStatusSchema.extract(["ACCEPTED"]),
    serverEventId: uuidV7,
    code: errorCodeSchema.optional(),
  }),
  resultBase.extend({
    status: syncResultStatusSchema.extract(["DUPLICATE"]),
    serverEventId: uuidV7.optional(),
    code: errorCodeSchema.optional(),
  }),
  resultBase.extend({
    status: syncResultStatusSchema.extract(["HELD_CONFLICT"]),
    conflictId: uuidV7,
    serverEventId: uuidV7.optional(),
    code: errorCodeSchema.optional(),
  }),
  resultBase.extend({
    status: syncResultStatusSchema.extract(["REJECTED"]),
    clientEventId: uuidV7.nullable(),
    /** Original zero-based input position, before deviceSeq processing order. */
    index: count,
    code: errorCodeSchema,
  }),
]);
export type SyncEventResult = z.infer<typeof syncEventResultSchema>;
export type RejectedSyncEventResult = Extract<SyncEventResult, { status: "REJECTED" }>;
export type ClientEventParseResult =
  { success: true; data: ClientEvent } | { success: false; rejection: RejectedSyncEventResult };

const clientEventFrameSchema = z
  .object({
    type: z.enum(FIELD_EVENT_TYPES),
    schemaVersion,
    payload: z.unknown(),
  })
  .passthrough();

/** Upcast payloads before current-schema validation; return normalized version and preserve correlation. */
export function parseClientEvent(
  raw: unknown,
  batchDeviceId: string,
  index: number,
  receivedAt: string,
  registry: UpcasterRegistry = upcasterRegistry,
): ClientEventParseResult {
  const identity = z.object({ clientEventId: uuidV7 }).safeParse(raw);
  const rejected: ClientEventParseResult = {
    success: false,
    rejection: {
      status: "REJECTED",
      clientEventId: identity.success ? identity.data.clientEventId : null,
      index,
      code: "SCHEMA_INVALID",
      receivedAt,
    },
  };
  const frame = clientEventFrameSchema.safeParse(raw);
  if (!frame.success) return rejected;
  try {
    const payload = upcastPayload(frame.data.type, frame.data.schemaVersion, frame.data.payload, registry);
    const parsed = clientEventSchema.safeParse({ ...frame.data, payload, schemaVersion: SCHEMA_VERSION });
    if (!parsed.success) return rejected;
    if (parsed.data.deviceId !== batchDeviceId) {
      return { success: false, rejection: { ...rejected.rejection, code: "FORBIDDEN" } };
    }
    return { success: true, data: parsed.data };
  } catch {
    // A malformed legacy payload must not let a throwing upcaster abort the batch.
    return rejected;
  }
}
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
    scope: z.strictObject({
      depot: nonempty,
      date: localDate,
      trips: z.array(tripSchema),
      reversals: z.array(orderSchema),
    }),
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
/**
 * The device's own held facts, looked up by clientEventId (ADR 0043). Unknown, foreign or not-held IDs are omitted.
 */
export const fieldConflictsRequestSchema = z.strictObject({
  clientEventIds: z.array(uuidV7).min(1).max(100),
  includeContext: z.boolean().optional(),
});
export const fieldConflictAssignmentSchema = z.strictObject({
  tripId: uuidV7,
  vehicleId: uuidV7,
});
export const fieldConflictContextSchema = z.strictObject({
  fact: eventEnvelopeSchema,
  original: z
    .strictObject({
      planVersion: count,
      tripId: uuidV7,
      tripDisplayId: nonempty,
      vehicleId: uuidV7,
      stop: stopSchema,
    })
    .nullable(),
  changes: z.array(
    z.strictObject({
      kind: z.enum(["REMOVED", "DEFERRED", "MOVED_VEHICLE", "MOVED_TRIP"]),
      fromVersion: count,
      toVersion: count,
      at: isoDateTime,
      from: fieldConflictAssignmentSchema.nullable(),
      to: fieldConflictAssignmentSchema.nullable(),
      reasonCode: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
const fieldConflictBase = z.strictObject({
  conflictId: uuidV7,
  clientEventId: uuidV7,
  kind: conflictKindSchema,
  openedAt: isoDateTime,
  context: fieldConflictContextSchema.optional(),
});
export const fieldConflictSchema = z.discriminatedUnion("state", [
  fieldConflictBase.extend({ state: z.literal("OPEN") }),
  fieldConflictBase.extend({
    state: z.literal("RESOLVED"),
    resolution: conflictResolutionSchema,
    note: z.string().nullable(),
    resolvedAt: isoDateTime,
  }),
]);
export const fieldConflictsResponseSchema = z.strictObject({
  items: z.array(fieldConflictSchema),
  resetEpoch: count.optional(),
  serverTime: isoDateTime,
  /** Confirmation boundary: a snapshot whose feedCursor is at or past this reflects every listed resolution. */
  feedHead: cursorSchema,
});
export const blobHeadersSchema = z.object({
  "content-type": z.enum(["image/jpeg", "image/png", "image/webp"]),
  "x-nextdrop-csrf": nonempty,
});
/** Server hard cap; client compression still targets approximately 200 KB. */
export const MAX_BLOB_BYTES = 512 * 1024;
// Bytes are a transport body, not JSON. The handler also limits raw upload bytes.
export const blobBodySchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_BLOB_BYTES, {
    message: `blob must contain 1..${MAX_BLOB_BYTES} bytes`,
  });
export const blobResponseSchema = z.strictObject({
  clientBlobId: uuidV7,
  mime: blobHeadersSchema.shape["content-type"],
  size: z.number().int().positive().max(MAX_BLOB_BYTES),
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
  fieldConflictsRequest: fieldConflictsRequestSchema,
  fieldConflict: fieldConflictSchema,
  fieldConflictsResponse: fieldConflictsResponseSchema,
  blobHeaders: blobHeadersSchema,
  blobBody: blobBodySchema,
  blobResponse: blobResponseSchema,
};
