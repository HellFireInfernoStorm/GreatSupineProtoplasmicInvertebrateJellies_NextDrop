import {
  CAUSE_KINDS,
  CONFLICT_RESOLUTIONS,
  HARD_CODES,
  ORDER_STATUSES,
  REASON_CODES,
  REVERSAL_TARGETS,
  SHORT_OUTCOMES,
  STOP_OUTCOMES,
  WARN_CODES,
} from "@nextdrop/rules";
import { z } from "zod";

export {
  CAUSE_KINDS,
  CONFLICT_RESOLUTIONS,
  HARD_CODES,
  ORDER_STATUSES,
  REASON_CODES,
  REVERSAL_TARGETS,
  SHORT_OUTCOMES,
  STOP_OUTCOMES,
  WARN_CODES,
};
export type { ConflictResolution, ReversalTarget, ShortOutcome, StopOutcome } from "@nextdrop/rules";

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const deferralReasonCodeSchema = z.enum(REASON_CODES);

export const causeKindSchema = z.enum(CAUSE_KINDS);

export const hardValidatorCodeSchema = z.enum(HARD_CODES);

export const warnValidatorCodeSchema = z.enum(WARN_CODES);

export const validatorCodeSchema = z.enum([...HARD_CODES, ...WARN_CODES]);

export const TRIP_STATUSES = ["PLANNED", "READY", "DEPARTED", "COMPLETE", "CANCELLED"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const tripStatusSchema = z.enum(TRIP_STATUSES);

export const PLANNING_DAY_STATES = ["OPEN", "CLOSED", "PLANNING", "PUBLISHED", "IN_PROGRESS", "COMPLETE"] as const;
export type PlanningDayState = (typeof PLANNING_DAY_STATES)[number];
export const planningDayStateSchema = z.enum(PLANNING_DAY_STATES);

export const shortOutcomeSchema = z.enum(SHORT_OUTCOMES);

export const stopOutcomeSchema = z.enum(STOP_OUTCOMES);

export const PROBLEM_KINDS = [
  "STORE_NOT_OPEN",
  "ROAD_BLOCKED",
  "DOCK_UNREACHABLE",
  "VEHICLE_PROBLEM",
  "RUNNING_LATE",
] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];
export const problemKindSchema = z.enum(PROBLEM_KINDS);

export const ISSUE_KINDS = ["SHORT", "DAMAGED", "WARM", "OTHER"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const issueKindSchema = z.enum(ISSUE_KINDS);

export const ISSUE_RESOLUTIONS = ["CREDIT", "ADD_TO_RUN", "REJECT"] as const;
export type IssueResolution = (typeof ISSUE_RESOLUTIONS)[number];
export const issueResolutionSchema = z.enum(ISSUE_RESOLUTIONS);

export const CONFLICT_KINDS = [
  "FACT_ON_CANCELLED_STOP",
  "FACT_ON_REASSIGNED_STOP",
  "DUPLICATE_DELIVERY_FACT",
  "LOAD_AGAINST_CHANGED_PLAN",
  "ILLEGAL_TRANSITION",
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];
export const conflictKindSchema = z.enum(CONFLICT_KINDS);

export const conflictResolutionSchema = z.enum(CONFLICT_RESOLUTIONS);

export const reversalTargetSchema = z.enum(REVERSAL_TARGETS);

export const VEHICLE_AVAILABILITY_STATUSES = ["AVAILABLE", "IN_WORKSHOP"] as const;
export type VehicleAvailabilityStatus = (typeof VEHICLE_AVAILABILITY_STATUSES)[number];
export const vehicleAvailabilityStatusSchema = z.enum(VEHICLE_AVAILABILITY_STATUSES);

export const VEHICLE_AVAILABILITY_REASONS = ["SERVICE", "BREAKDOWN"] as const;
export type VehicleAvailabilityReason = (typeof VEHICLE_AVAILABILITY_REASONS)[number];
export const vehicleAvailabilityReasonSchema = z.enum(VEHICLE_AVAILABILITY_REASONS);

export const DEFERRAL_DECIDED_BY = ["DISPATCHER", "SYSTEM"] as const;
export type DeferralDecidedBy = (typeof DEFERRAL_DECIDED_BY)[number];
export const deferralDecidedBySchema = z.enum(DEFERRAL_DECIDED_BY);

/** Loader shortfall and damage flags on an order (not statuses). */
export const orderFlagSchema = z.object({
  short: z.array(
    z.object({
      lineId: z.string().min(1),
      qtyShort: z.number().int().nonnegative(),
      resolution: shortOutcomeSchema.nullable().optional(),
    }),
  ),
  damaged: z.array(
    z.object({
      lineId: z.string().min(1),
      qty: z.number().int().nonnegative(),
    }),
  ),
});
