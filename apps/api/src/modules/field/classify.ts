// Conflict classification for field facts (spec/sync/recovery-and-conflicts.md §9.5, ADR 0040).
// Pure: ingest loads the plan context and the order's history, this decides.
import type { ConflictKind, FieldEventType } from "@nextdrop/contracts";
import type { ReduceOutcome } from "@nextdrop/rules";

/** Facts the driver records at a stop (recovery rule 1). */
export const DELIVERY_FACTS: ReadonlySet<FieldEventType> = new Set(["STOP_ARRIVED", "STOP_OUTCOME", "POD_CAPTURED"]);
/** Facts that happened in the world: never lost, so an illegal one is held for the dispatcher, not rejected. */
export const HOLDABLE_FACTS: ReadonlySet<FieldEventType> = new Set([...DELIVERY_FACTS, "LOAD_CONFIRMED"]);
/** Delivery facts two devices may not both report for one stop. */
const SINGLE_REPORT: ReadonlySet<FieldEventType> = new Set(["STOP_OUTCOME", "POD_CAPTURED"]);
/** Plan changes that take a stop away from where the device saw it. */
const MOVES_STOP: ReadonlySet<string> = new Set(["REMOVED", "DEFERRED", "MOVED_VEHICLE", "MOVED_TRIP"]);

export interface Slot {
  tripId: string;
  vehicleId: string;
}

/** The plan as the device saw it (`basedOnPlanVersion = v`) and what changed since, for the event's planning day. */
export interface PlanContext {
  /** Where version v had the order, or null when v did not hold it. */
  slotAtV: Slot | null;
  /** `PlanVersionChange.change` values for this order in `(v, V]`. */
  changes: readonly string[];
}

export interface ClassifyInput {
  type: FieldEventType;
  /** Null when the event has no `basedOnPlanVersion`, or v is the current version. */
  plan: PlanContext | null;
  /** The order's current active stop. */
  current: Slot | null;
  /** Device ids of applied events of this type on the order. */
  appliedSameTypeDevices: readonly (string | null)[];
  deviceId: string;
  /** What the reducer would do with the event now. */
  outcome: ReduceOutcome;
}

export type Classification = { kind: "APPLY" } | { kind: "HOLD"; conflict: ConflictKind } | { kind: "REJECT" };

const sameSlot = (a: Slot | null, b: Slot | null) => a !== null && b !== null && a.tripId === b.tripId;

export function classifyFact(input: ClassifyInput): Classification {
  const { type, plan, current } = input;

  // A newer plan moved or removed the stop the device was working from.
  if (plan && plan.slotAtV && plan.changes.some((c) => MOVES_STOP.has(c)) && !sameSlot(plan.slotAtV, current)) {
    if (DELIVERY_FACTS.has(type)) {
      return { kind: "HOLD", conflict: current ? "FACT_ON_REASSIGNED_STOP" : "FACT_ON_CANCELLED_STOP" };
    }
    if (type === "LOAD_CONFIRMED") return { kind: "HOLD", conflict: "LOAD_AGAINST_CHANGED_PLAN" };
  }

  // Two devices report the outcome (or proof) of the same stop.
  if (SINGLE_REPORT.has(type) && input.appliedSameTypeDevices.some((device) => device !== input.deviceId)) {
    return { kind: "HOLD", conflict: "DUPLICATE_DELIVERY_FACT" };
  }

  if (input.outcome.kind === "ILLEGAL_TRANSITION") {
    // A device contradicting its own applied outcome is corrected on the device, not escalated.
    const ownOutcome = type === "STOP_OUTCOME" && input.appliedSameTypeDevices.includes(input.deviceId);
    if (HOLDABLE_FACTS.has(type) && !ownOutcome) return { kind: "HOLD", conflict: "ILLEGAL_TRANSITION" };
    return { kind: "REJECT" };
  }
  return { kind: "APPLY" };
}
