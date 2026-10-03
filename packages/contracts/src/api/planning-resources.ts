import { PRIORITY_CLASSES, type RulesConfig } from "@nextdrop/rules";
import { z } from "zod";
import { localDate, isoDateTime, uuidV7 } from "../primitives";
import { causeKindSchema, deferralReasonCodeSchema, validatorCodeSchema } from "../vocab";
import { scoreInputsSchema } from "../payloads/order-lifecycle";
import { count, minute, nonempty } from "./common";
import { tripSchema } from "./resources";

export const rulesConfigSchema = z.strictObject({
  cutoffMinute: minute,
  freshFirstDepartureMinute: minute,
  freshWindowEndMinute: minute,
  tradingDayStartMinute: minute,
  freshBudgetMin: count,
  styleTechBudgetMin: count,
  maxTripsPerVehicle: count,
  reloadBufferMin: count,
  fuelIncludeReturn: z.boolean(),
  etaWindowMin: count,
  validationEtaIncludesReturn: z.boolean(),
  priorityOrder: z.array(z.enum(PRIORITY_CLASSES)).readonly(),
  agingDeferralCount: count,
  staleServiceDays: count,
  lowFuelMarginPct: count,
  localSearchIterationCap: count,
  localSearchSeed: count,
});
export type RulesConfigDto = z.infer<typeof rulesConfigSchema>;
const rulesConfigMatches: RulesConfig extends RulesConfigDto
  ? RulesConfigDto extends RulesConfig
    ? true
    : never
  : never = true;
void rulesConfigMatches;
export const deferralSchema = z.strictObject({
  orderId: uuidV7,
  reasonCode: deferralReasonCodeSchema,
  causeKind: causeKindSchema,
  bindingConstraint: z.union([validatorCodeSchema, z.literal("NO_ELIGIBLE_VEHICLE")]).nullable(),
  scoreInputs: scoreInputsSchema.nullable(),
  displacedBy: z.array(uuidV7),
  note: z.string(),
  nextServiceableDate: localDate,
  daysUnserved: count,
  consecutiveDeferrals: count,
});
export const draftTripSchema = z.strictObject({
  ref: nonempty,
  vehicleId: uuidV7,
  tripNo: z.union([z.literal(1), z.literal(2)]),
  orderIds: z.array(uuidV7),
});
export const draftDataSchema = z.strictObject({
  trips: z.array(draftTripSchema),
  unassignedOrderIds: z.array(uuidV7),
  deferrals: z.array(
    z.strictObject({ orderId: uuidV7, reasonCode: deferralReasonCodeSchema.optional(), note: z.string().optional() }),
  ),
});
export const draftSchema = z.strictObject({
  revision: z.number().int().positive(),
  baseVersion: count.nullable(),
  data: draftDataSchema,
  updatedAt: isoDateTime,
});
export const planVersionSchema = z.strictObject({
  version: count,
  publishedAt: isoDateTime,
  publishedBy: nonempty,
  trips: z.array(tripSchema),
  deferrals: z.array(deferralSchema),
  summary: z.strictObject({ served: count, deferred: count, trips: count }),
});
export const allocationStatsSchema = z.strictObject({
  orders: count,
  served: count,
  deferred: count,
  demandVolumeL: z.strictObject({ FRESH: count, STYLE_TECH: count }),
  servedVolumeL: z.strictObject({ FRESH: count, STYLE_TECH: count }),
  vehiclesAvailable: count,
  vehiclesUsed: count,
  tripSlotsAvailable: count,
  tripsUsed: count,
  reefers: z.strictObject({ available: count, used: count }),
  vans: z.strictObject({ available: count, used: count }),
  localSearchMoves: count,
});
export const planningResourceSchemas = {
  rulesConfig: rulesConfigSchema,
  deferral: deferralSchema,
  draftTrip: draftTripSchema,
  draftData: draftDataSchema,
  draft: draftSchema,
  planVersion: planVersionSchema,
  allocationStats: allocationStatsSchema,
};
