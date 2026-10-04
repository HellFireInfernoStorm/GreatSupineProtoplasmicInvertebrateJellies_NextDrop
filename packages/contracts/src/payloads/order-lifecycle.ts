import { PRIORITY_CLASSES, type ScoreInputs } from "@nextdrop/rules";
import { z } from "zod";
import {
  damagedLineSchema,
  isoDateTime,
  lineIdSchema,
  loadedLineSchema,
  localDate,
  shortLineSchema,
  stopLineSchema,
  uuidV7,
} from "../primitives";
import {
  causeKindSchema,
  conflictKindSchema,
  conflictResolutionSchema,
  deferralDecidedBySchema,
  deferralReasonCodeSchema,
  issueKindSchema,
  issueResolutionSchema,
  loadDamagedReasonCodeSchema,
  problemKindSchema,
  reversalTargetSchema,
  shortOutcomeSchema,
  stopOutcomeSchema,
  vehicleAvailabilityReasonSchema,
  vehicleAvailabilityStatusSchema,
} from "../vocab";

export const orderPlacedPayloadSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: lineIdSchema,
        skuId: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
  requestedDate: localDate,
  replacesOrderId: uuidV7.optional(),
});

export const orderCancelledPayloadSchema = z.object({
  reason: z.string().optional(),
});

export const orderPlannedPayloadSchema = z.object({
  tripId: uuidV7,
  vehicleId: uuidV7,
  seq: z.number().int().nonnegative(),
  etaFrom: isoDateTime,
  etaTo: isoDateTime,
  planVersion: z.number().int().nonnegative(),
});

export const planAssignmentSnapshotSchema = z.object({
  tripId: uuidV7,
  vehicleId: uuidV7,
  seq: z.number().int().nonnegative(),
  etaFrom: isoDateTime,
  etaTo: isoDateTime,
});

export const planChangedPayloadSchema = z.object({
  from: planAssignmentSnapshotSchema,
  to: planAssignmentSnapshotSchema,
  planVersion: z.number().int().nonnegative(),
});

export const scoreInputsSchema = z.object({
  priorityClass: z.enum(PRIORITY_CLASSES),
  aged: z.boolean(),
  deferredYesterday: z.boolean(),
  daysSinceLastServed: z.number().int().nonnegative(),
  deferredCount: z.number().int().nonnegative(),
  slip: z.number().int(),
  volumeL: z.number(),
});

type ScoreInputsParsed = z.infer<typeof scoreInputsSchema>;
type _ScoreInputsMatch = ScoreInputsParsed extends ScoreInputs
  ? ScoreInputs extends ScoreInputsParsed
    ? true
    : never
  : never;
const _scoreInputsMatch: _ScoreInputsMatch = true;
void _scoreInputsMatch;

export const orderDeferredPayloadSchema = z.object({
  reasonCode: deferralReasonCodeSchema,
  causeKind: causeKindSchema,
  scoreInputs: scoreInputsSchema.nullable(),
  toDate: localDate,
  daysUnserved: z.number().int().nonnegative(),
  consecutiveDeferrals: z.number().int().nonnegative(),
  note: z.string(),
  decidedBy: deferralDecidedBySchema,
  planVersion: z.number().int().nonnegative().optional(),
});

export const planAcknowledgedPayloadSchema = z.object({
  planVersion: z.number().int().nonnegative(),
});

export const loadShortPayloadSchema = z.object({
  lines: z.array(shortLineSchema).min(1),
  reasonCode: z.string().min(1),
  photoRef: z.string().optional(),
});

export const loadDamagedPayloadSchema = z.object({
  lines: z.array(damagedLineSchema).min(1),
  reasonCode: loadDamagedReasonCodeSchema,
  photoRef: z.string().optional(),
});

export const loadConfirmedPayloadSchema = z.object({
  lines: z.array(loadedLineSchema).min(1),
});

export const shortResolvedPayloadSchema = z.object({
  orderId: uuidV7,
  lineId: lineIdSchema,
  outcome: shortOutcomeSchema,
  note: z.string().optional(),
});

export const loadReversalRequestedPayloadSchema = z.object({
  orderId: uuidV7,
  to: reversalTargetSchema,
  planVersion: z.number().int().nonnegative(),
});

export const loadReversedPayloadSchema = z.object({
  orderId: uuidV7,
  lines: z.array(loadedLineSchema),
});

export const tripReadyPayloadSchema = z.object({
  tripId: uuidV7,
});

export const tripDepartedPayloadSchema = z.object({
  tripId: uuidV7,
});

export const orderOutForDeliveryPayloadSchema = z.object({
  tripId: uuidV7.optional(),
});

export const stopArrivedPayloadSchema = z.object({
  orderId: uuidV7,
});

export const stopOutcomePayloadSchema = z.object({
  outcome: stopOutcomeSchema,
  lines: z.array(stopLineSchema).optional(),
  reasonCode: z.string().optional(),
});

export const podCapturedPayloadSchema = z.object({
  receiverName: z.string().min(1),
  signatureBlobRef: z.string().optional(),
  photoBlobRefs: z.array(z.string()),
});

export const problemFlaggedPayloadSchema = z.object({
  kind: problemKindSchema,
  note: z.string().optional(),
  photoRef: z.string().optional(),
});

export const receiptConfirmedPayloadSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: lineIdSchema,
        qtyReceived: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export const issueReportedPayloadSchema = z.object({
  kind: issueKindSchema,
  lines: z
    .array(
      z.object({
        lineId: lineIdSchema,
        qty: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  photo: z.string().optional(),
  note: z.string().optional(),
});

export const issueResolvedPayloadSchema = z.object({
  resolution: issueResolutionSchema,
  note: z.string().optional(),
});

export const vehicleAvailabilityChangedPayloadSchema = z.object({
  vehicleId: uuidV7,
  date: localDate,
  status: vehicleAvailabilityStatusSchema,
  reason: vehicleAvailabilityReasonSchema,
  note: z.string().optional(),
  sourceEventId: uuidV7.optional(),
});

export const conflictOpenedPayloadSchema = z.object({
  conflictId: uuidV7,
  kind: conflictKindSchema,
  heldEventId: uuidV7,
});

export const conflictResolvedPayloadSchema = z.object({
  conflictId: uuidV7,
  resolution: conflictResolutionSchema,
  note: z.string().optional(),
  heldEventId: uuidV7.optional(),
});
