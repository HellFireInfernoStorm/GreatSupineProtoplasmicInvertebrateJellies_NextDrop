import type { EventType } from "../event-types";
import { ID, ID2, ID3, LINE, VEHICLE, validPayloads } from "./fixtures";

/** One invalid payload example per event type for schema tests. */
export function invalidPayloadFor(type: EventType): unknown {
  switch (type) {
    case "ORDER_PLACED":
      return { lines: [], requestedDate: "2026-10-04" };
    case "ORDER_CANCELLED":
      return { reason: 42 };
    case "ORDER_PLANNED":
      return { tripId: "bad", vehicleId: VEHICLE, planVersion: 1 };
    case "PLAN_CHANGED":
      return { planVersion: -1 };
    case "ORDER_DEFERRED":
      return { reasonCode: "OTHER", causeKind: "INVALID" };
    case "PLAN_ACKNOWLEDGED":
      return { planVersion: 1.5 };
    case "LOAD_SHORT":
      return { lines: [{ lineId: LINE, qtyShort: -1 }] };
    case "LOAD_DAMAGED":
      return { lines: [{ lineId: LINE, qty: 1 }], reasonCode: "NOT_A_DAMAGE_REASON" };
    case "LOAD_CONFIRMED":
      return { lines: [] };
    case "SHORT_RESOLVED":
      return { orderId: ID2, lineId: LINE, outcome: "NOPE" };
    case "LOAD_REVERSAL_REQUESTED":
      return { orderId: ID2, to: "LOADED", planVersion: 1 };
    case "LOAD_REVERSED":
      return { orderId: "bad-uuid" };
    case "TRIP_READY":
      return { tripId: "not-uuid" };
    case "TRIP_DEPARTED":
      return { tripId: "not-uuid" };
    case "ORDER_OUT_FOR_DELIVERY":
      return { tripId: "not-uuid" };
    case "STOP_ARRIVED":
      return { orderId: "not-uuid" };
    case "STOP_OUTCOME":
      return { outcome: "MAYBE" };
    case "POD_CAPTURED":
      return { receiverName: "" };
    case "PROBLEM_FLAGGED":
      return { kind: "INVALID" };
    case "RECEIPT_CONFIRMED":
      return { lines: [{ lineId: LINE, qtyReceived: -1 }] };
    case "ISSUE_REPORTED":
      return { kind: "UNKNOWN" };
    case "ISSUE_RESOLVED":
      return { resolution: "UNKNOWN" };
    case "VEHICLE_AVAILABILITY_CHANGED":
      return {
        vehicleId: VEHICLE,
        date: "not-a-date",
        status: "AVAILABLE",
        reason: "SERVICE",
      };
    case "CONFLICT_OPENED":
      return { conflictId: ID3, kind: "UNKNOWN", heldEventId: ID };
    case "CONFLICT_RESOLVED":
      return { conflictId: ID3, resolution: "MAYBE" };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** Ensures fixtures stay aligned with EVENT_TYPES. */
export function assertFixtureCoverage(types: readonly EventType[]): void {
  for (const type of types) {
    void validPayloads[type];
    void invalidPayloadFor(type);
  }
}
