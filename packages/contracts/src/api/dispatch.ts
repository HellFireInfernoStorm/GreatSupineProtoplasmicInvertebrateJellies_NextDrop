import { z } from "zod";
import { actorSchema, isoDateTime, localDate, uuidV7 } from "../primitives";
import {
  conflictKindSchema,
  issueKindSchema,
  planningDayStateSchema,
  problemKindSchema,
  shortOutcomeSchema,
  vehicleAvailabilityStatusSchema,
  vehicleAvailabilityReasonSchema,
  conflictResolutionSchema,
} from "../vocab";
import {
  conflictResolvedPayloadSchema,
  issueResolvedPayloadSchema,
  vehicleAvailabilityChangedPayloadSchema,
  planAcknowledgedPayloadSchema,
} from "../payloads/order-lifecycle";
import { apiErrorSchema, count, nonempty, validationResultSchema } from "./common";
import { allocationStatsSchema, draftDataSchema, draftSchema, planVersionSchema } from "./planning-resources";
import { orderSchema, tripSchema, vehicleSchema } from "./resources";

export const dayQuerySchema = z.strictObject({ depot: nonempty });
export const dayResponseSchema = z.strictObject({
  date: localDate,
  depot: nonempty,
  state: planningDayStateSchema,
  ordersClosedAt: isoDateTime.nullable(),
  currentVersion: count.nullable(),
  queue: z.array(orderSchema),
  demandCapacity: allocationStatsSchema,
  serverTime: isoDateTime,
});
export const proposeRequestSchema = z.strictObject({ revision: count });
export const proposeResponseSchema = z.strictObject({
  draft: draftSchema,
  stats: allocationStatsSchema,
  trace: z.array(z.string()),
});
export const saveDraftRequestSchema = z.strictObject({ revision: count, data: draftDataSchema });
export const draftResponseSchema = z.strictObject({ draft: draftSchema.nullable() });
export const validateRequestSchema = z.strictObject({ data: draftDataSchema });
export const publishRequestSchema = z.strictObject({ revision: count });
export const publishResponseSchema = z.strictObject({ plan: planVersionSchema, serverTime: isoDateTime });
export const validationErrorResponseSchema = apiErrorSchema.extend({ validation: validationResultSchema });
export const versionsResponseSchema = z.strictObject({ items: z.array(planVersionSchema) });
export const runSchema = z.strictObject({
  vehicle: vehicleSchema,
  trips: z.array(tripSchema),
  stopsDone: count,
  stopsTotal: count,
  lastHeardAt: isoDateTime.nullable(),
  lastSyncAt: isoDateTime.nullable(),
  pendingCount: count,
  lateRisk: z.boolean(),
  state: z.enum(["ON_TRACK", "NO_SIGNAL", "BEHIND", "ESCALATED", "DONE"]),
});
export const runsResponseSchema = z.strictObject({ items: z.array(runSchema), serverTime: isoDateTime });
export const conflictSchema = z.strictObject({
  id: uuidV7,
  kind: conflictKindSchema,
  state: z.enum(["OPEN", "RESOLVED"]),
  orderId: uuidV7.nullable(),
  tripId: uuidV7.nullable(),
  heldEventId: uuidV7,
  openedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  resolution: conflictResolutionSchema.nullable(),
  note: z.string().nullable(),
});
export const issueSchema = z.strictObject({
  id: uuidV7,
  orderId: uuidV7,
  kind: issueKindSchema,
  openedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  note: z.string().nullable(),
});
export const exceptionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ACK"),
    tripId: uuidV7,
    planVersion: planAcknowledgedPayloadSchema.shape.planVersion,
    actor: actorSchema.strict(),
    at: isoDateTime,
  }),
  z.strictObject({ type: z.literal("CONFLICT"), conflict: conflictSchema }),
  z.strictObject({ type: z.literal("ISSUE"), issue: issueSchema }),
  z.strictObject({
    type: z.literal("SHORT"),
    orderId: uuidV7,
    lineId: nonempty,
    qtyShort: z.number().int().positive(),
    resolution: shortOutcomeSchema.nullable(),
  }),
  z.strictObject({ type: z.literal("DAMAGED"), orderId: uuidV7, lineId: nonempty, qty: z.number().int().positive() }),
  z.strictObject({ type: z.literal("FAILED"), order: orderSchema }),
  z.strictObject({
    type: z.literal("PROBLEM"),
    eventId: uuidV7,
    orderId: uuidV7.nullable(),
    tripId: uuidV7.nullable(),
    kind: problemKindSchema,
    note: z.string().nullable(),
  }),
]);
export const exceptionsResponseSchema = z.strictObject({ items: z.array(exceptionSchema) });
export const resolveConflictRequestSchema = conflictResolvedPayloadSchema
  .omit({ conflictId: true, heldEventId: true })
  .strict();
export const resolveIssueRequestSchema = issueResolvedPayloadSchema.strict();
export const fleetResponseSchema = z.strictObject({
  date: localDate,
  items: z.array(
    z.strictObject({
      vehicle: vehicleSchema,
      availability: z.strictObject({
        status: vehicleAvailabilityStatusSchema,
        reason: vehicleAvailabilityReasonSchema.nullable(),
        note: z.string().nullable(),
        changedAt: isoDateTime.nullable(),
      }),
    }),
  ),
});
export const updateFleetRequestSchema = z.strictObject({
  changes: z.array(vehicleAvailabilityChangedPayloadSchema.omit({ sourceEventId: true }).strict()).min(1),
});
export const outlookQuerySchema = z.strictObject({
  depot: nonempty,
  from: localDate,
  weeks: z.coerce.number().int().min(1).max(52),
});
export const outlookResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      isoYear: count,
      isoWeek: z.number().int().min(1).max(53),
      brand: orderSchema.shape.brand,
      demandVolumeL: count,
      chilledVolumeL: count,
      capacityVolumeL: count,
    }),
  ),
  serverTime: isoDateTime,
});
export const dispatchSchemas = {
  dayQuery: dayQuerySchema,
  dayResponse: dayResponseSchema,
  proposeRequest: proposeRequestSchema,
  proposeResponse: proposeResponseSchema,
  saveDraftRequest: saveDraftRequestSchema,
  draftResponse: draftResponseSchema,
  validateRequest: validateRequestSchema,
  publishRequest: publishRequestSchema,
  publishResponse: publishResponseSchema,
  validationErrorResponse: validationErrorResponseSchema,
  versionsResponse: versionsResponseSchema,
  run: runSchema,
  runsResponse: runsResponseSchema,
  conflict: conflictSchema,
  issue: issueSchema,
  exception: exceptionSchema,
  exceptionsResponse: exceptionsResponseSchema,
  resolveConflictRequest: resolveConflictRequestSchema,
  resolveIssueRequest: resolveIssueRequestSchema,
  fleetResponse: fleetResponseSchema,
  updateFleetRequest: updateFleetRequestSchema,
  outlookQuery: outlookQuerySchema,
  outlookResponse: outlookResponseSchema,
};
