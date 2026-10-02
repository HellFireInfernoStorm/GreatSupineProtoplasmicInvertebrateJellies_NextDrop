import type { EventType } from "../event-types";
import type { EnvelopeBase, EventEnvelope } from "../envelope";
import { SCHEMA_VERSION } from "../schema-version";

export const ID = "018f1234-5678-7890-abcd-ef1234567890";
export const ID2 = "018f1234-5678-7890-abcd-ef1234567891";
export const ID3 = "018f1234-5678-7890-abcd-ef1234567892";
export const TRIP = "018f1234-5678-7890-abcd-ef1234567893";
export const VEHICLE = "018f1234-5678-7890-abcd-ef1234567894";
export const LINE = "line-1";

const base = (): EnvelopeBase => ({
  id: ID,
  schemaVersion: SCHEMA_VERSION,
  subject: { orderId: ID2 },
  source: "SERVER",
  actor: { userId: "user-1", role: "DISPATCHER" },
  capturedAt: "2026-10-03T10:00:00.000Z",
  receivedAt: "2026-10-03T10:00:00.001Z",
  disposition: "APPLIED",
});

const assignment = {
  tripId: TRIP,
  vehicleId: VEHICLE,
  seq: 1,
  etaFrom: "2026-10-04T03:30:00.000Z",
  etaTo: "2026-10-04T04:00:00.000Z",
};

export const validPayloads: { [K in EventType]: Extract<EventEnvelope, { type: K }> } = {
  ORDER_PLACED: {
    ...base(),
    type: "ORDER_PLACED",
    payload: {
      lines: [{ lineId: LINE, skuId: "sku-1", qty: 2 }],
      requestedDate: "2026-10-04",
    },
  },
  ORDER_CANCELLED: { ...base(), type: "ORDER_CANCELLED", payload: { reason: "store request" } },
  ORDER_PLANNED: {
    ...base(),
    type: "ORDER_PLANNED",
    payload: {
      tripId: TRIP,
      vehicleId: VEHICLE,
      seq: 1,
      etaFrom: "2026-10-04T03:30:00.000Z",
      etaTo: "2026-10-04T04:00:00.000Z",
      planVersion: 1,
    },
  },
  PLAN_CHANGED: {
    ...base(),
    type: "PLAN_CHANGED",
    payload: {
      from: assignment,
      to: {
        ...assignment,
        seq: 2,
        etaFrom: "2026-10-04T04:00:00.000Z",
        etaTo: "2026-10-04T04:30:00.000Z",
      },
      planVersion: 2,
    },
  },
  ORDER_DEFERRED: {
    ...base(),
    type: "ORDER_DEFERRED",
    payload: {
      reasonCode: "TIME_BUDGET",
      causeKind: "UNAVOIDABLE_POOL_EXHAUSTED",
      scoreInputs: {
        priorityClass: "OTHER_FRESH",
        aged: false,
        deferredYesterday: false,
        daysSinceLastServed: 1,
        deferredCount: 1,
        slip: 1,
        volumeL: 12,
      },
      toDate: "2026-10-05",
      daysUnserved: 1,
      consecutiveDeferrals: 1,
      note: "pool exhausted",
      decidedBy: "SYSTEM",
    },
  },
  PLAN_ACKNOWLEDGED: { ...base(), type: "PLAN_ACKNOWLEDGED", payload: { planVersion: 1 } },
  LOAD_SHORT: {
    ...base(),
    type: "LOAD_SHORT",
    source: "FIELD",
    payload: { lines: [{ lineId: LINE, qtyShort: 1 }], reasonCode: "MISSING_STOCK" },
  },
  LOAD_DAMAGED: {
    ...base(),
    type: "LOAD_DAMAGED",
    source: "FIELD",
    payload: { lines: [{ lineId: LINE, qty: 1 }] },
  },
  LOAD_CONFIRMED: {
    ...base(),
    type: "LOAD_CONFIRMED",
    source: "FIELD",
    payload: { lines: [{ lineId: LINE, qtyLoaded: 2 }] },
  },
  SHORT_RESOLVED: {
    ...base(),
    type: "SHORT_RESOLVED",
    payload: { orderId: ID2, lineId: LINE, outcome: "SHIP_PARTIAL" },
  },
  LOAD_REVERSAL_REQUESTED: {
    ...base(),
    type: "LOAD_REVERSAL_REQUESTED",
    payload: { orderId: ID2, to: "PLANNED", planVersion: 3 },
  },
  LOAD_REVERSED: {
    ...base(),
    type: "LOAD_REVERSED",
    source: "FIELD",
    payload: { orderId: ID2, lines: [{ lineId: LINE, qtyLoaded: 2 }] },
  },
  TRIP_READY: { ...base(), type: "TRIP_READY", subject: { tripId: TRIP }, payload: { tripId: TRIP } },
  TRIP_DEPARTED: {
    ...base(),
    type: "TRIP_DEPARTED",
    source: "FIELD",
    subject: { tripId: TRIP },
    payload: { tripId: TRIP },
  },
  ORDER_OUT_FOR_DELIVERY: {
    ...base(),
    type: "ORDER_OUT_FOR_DELIVERY",
    payload: { tripId: TRIP },
  },
  STOP_ARRIVED: {
    ...base(),
    type: "STOP_ARRIVED",
    source: "FIELD",
    payload: { orderId: ID2 },
  },
  STOP_OUTCOME: {
    ...base(),
    type: "STOP_OUTCOME",
    source: "FIELD",
    payload: { outcome: "FULL" },
  },
  POD_CAPTURED: {
    ...base(),
    type: "POD_CAPTURED",
    source: "FIELD",
    payload: { receiverName: "Manager", photoBlobRefs: [] },
  },
  PROBLEM_FLAGGED: {
    ...base(),
    type: "PROBLEM_FLAGGED",
    source: "FIELD",
    payload: { kind: "RUNNING_LATE" },
  },
  RECEIPT_CONFIRMED: {
    ...base(),
    type: "RECEIPT_CONFIRMED",
    payload: { lines: [{ lineId: LINE, qtyReceived: 2 }] },
  },
  ISSUE_REPORTED: {
    ...base(),
    type: "ISSUE_REPORTED",
    source: "SERVER",
    actor: { userId: "store-1", role: "STORE" },
    payload: { kind: "SHORT" },
  },
  ISSUE_RESOLVED: {
    ...base(),
    type: "ISSUE_RESOLVED",
    payload: { resolution: "CREDIT" },
  },
  VEHICLE_AVAILABILITY_CHANGED: {
    ...base(),
    type: "VEHICLE_AVAILABILITY_CHANGED",
    subject: { vehicleId: VEHICLE },
    payload: {
      vehicleId: VEHICLE,
      date: "2026-10-04",
      status: "IN_WORKSHOP",
      reason: "BREAKDOWN",
    },
  },
  CONFLICT_OPENED: {
    ...base(),
    type: "CONFLICT_OPENED",
    payload: {
      conflictId: ID3,
      kind: "LOAD_AGAINST_CHANGED_PLAN",
      heldEventId: ID,
    },
  },
  CONFLICT_RESOLVED: {
    ...base(),
    type: "CONFLICT_RESOLVED",
    payload: { conflictId: ID3, resolution: "ACCEPT_FACT" },
  },
};
