import type { z } from "zod";
import type { EventType } from "./event-types";
import {
  conflictOpenedPayloadSchema,
  conflictResolvedPayloadSchema,
  issueReportedPayloadSchema,
  issueResolvedPayloadSchema,
  loadConfirmedPayloadSchema,
  loadDamagedPayloadSchema,
  loadReversalRequestedPayloadSchema,
  loadReversedPayloadSchema,
  loadShortPayloadSchema,
  orderCancelledPayloadSchema,
  orderDeferredPayloadSchema,
  orderOutForDeliveryPayloadSchema,
  orderPlacedPayloadSchema,
  orderPlannedPayloadSchema,
  planAcknowledgedPayloadSchema,
  planChangedPayloadSchema,
  podCapturedPayloadSchema,
  problemFlaggedPayloadSchema,
  receiptConfirmedPayloadSchema,
  shortResolvedPayloadSchema,
  stopArrivedPayloadSchema,
  stopOutcomePayloadSchema,
  tripDepartedPayloadSchema,
  tripReadyPayloadSchema,
  vehicleAvailabilityChangedPayloadSchema,
} from "./payloads/order-lifecycle";

export const eventPayloadSchemas = {
  ORDER_PLACED: orderPlacedPayloadSchema,
  ORDER_CANCELLED: orderCancelledPayloadSchema,
  ORDER_PLANNED: orderPlannedPayloadSchema,
  PLAN_CHANGED: planChangedPayloadSchema,
  ORDER_DEFERRED: orderDeferredPayloadSchema,
  PLAN_ACKNOWLEDGED: planAcknowledgedPayloadSchema,
  LOAD_SHORT: loadShortPayloadSchema,
  LOAD_DAMAGED: loadDamagedPayloadSchema,
  LOAD_CONFIRMED: loadConfirmedPayloadSchema,
  SHORT_RESOLVED: shortResolvedPayloadSchema,
  LOAD_REVERSAL_REQUESTED: loadReversalRequestedPayloadSchema,
  LOAD_REVERSED: loadReversedPayloadSchema,
  TRIP_READY: tripReadyPayloadSchema,
  TRIP_DEPARTED: tripDepartedPayloadSchema,
  ORDER_OUT_FOR_DELIVERY: orderOutForDeliveryPayloadSchema,
  STOP_ARRIVED: stopArrivedPayloadSchema,
  STOP_OUTCOME: stopOutcomePayloadSchema,
  POD_CAPTURED: podCapturedPayloadSchema,
  PROBLEM_FLAGGED: problemFlaggedPayloadSchema,
  RECEIPT_CONFIRMED: receiptConfirmedPayloadSchema,
  ISSUE_REPORTED: issueReportedPayloadSchema,
  ISSUE_RESOLVED: issueResolvedPayloadSchema,
  VEHICLE_AVAILABILITY_CHANGED: vehicleAvailabilityChangedPayloadSchema,
  CONFLICT_OPENED: conflictOpenedPayloadSchema,
  CONFLICT_RESOLVED: conflictResolvedPayloadSchema,
} as const satisfies Record<EventType, z.ZodType>;

export type EventPayloadMap = {
  [K in EventType]: z.infer<(typeof eventPayloadSchemas)[K]>;
};

export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayloadMap[T] {
  return eventPayloadSchemas[type].parse(payload) as EventPayloadMap[T];
}
