import type { ApiDtoInput } from "./schemas";
import { apiFixtures as f } from "./fixtures";

type Variants<T, D extends keyof T> = { [K in T[D] & string]: Extract<T, Record<D, K>> };
type VariantFixtures = {
  loginRequest: Variants<ApiDtoInput<"loginRequest">, "role">;
  sessionUser: Variants<ApiDtoInput<"sessionUser">, "role">;
  fieldSnapshot: Variants<ApiDtoInput<"fieldSnapshot">, "role">;
  syncEventResult: Variants<ApiDtoInput<"syncEventResult">, "status">;
  exception: Variants<ApiDtoInput<"exception">, "type">;
};

const result = { clientEventId: f.clientEvent.clientEventId, receivedAt: f.clientEvent.capturedAt };
const user = { id: "mock-user", displayName: "Mock user", locale: "en" };
/** Populated examples for every public role/result/exception variant. */
export const apiVariantFixtures = {
  loginRequest: {
    STORE: f.loginRequest,
    DISPATCHER: { role: "DISPATCHER", email: "dispatcher@example.com", password: "mock-password", depot: "Peliyagoda" },
    LOADER: { role: "LOADER", loginId: "LDR001", pin: "1234", deviceId: f.clientEvent.deviceId },
    DRIVER: { role: "DRIVER", loginId: "DRV001", pin: "1234", deviceId: f.clientEvent.deviceId },
  },
  sessionUser: {
    STORE: f.sessionUser,
    DISPATCHER: { ...user, role: "DISPATCHER", depots: ["Peliyagoda", "Kandy"] },
    LOADER: { ...user, role: "LOADER", depot: "Peliyagoda" },
    DRIVER: { ...user, role: "DRIVER", vehicleId: f.vehicle.id },
  },
  fieldSnapshot: {
    LOADER: f.fieldSnapshot,
    DRIVER: {
      ...f.fieldSnapshot,
      role: "DRIVER",
      scope: { date: f.fieldSnapshot.scope.date, vehicle: f.vehicle, trips: [f.trip] },
    },
  },
  syncEventResult: {
    ACCEPTED: f.syncEventResult,
    DUPLICATE: { ...result, status: "DUPLICATE", serverEventId: f.syncEventResult.serverEventId, code: "DUPLICATE" },
    HELD_CONFLICT: {
      ...result,
      status: "HELD_CONFLICT",
      conflictId: f.conflict.id,
      serverEventId: f.syncEventResult.serverEventId,
    },
    REJECTED: { ...result, status: "REJECTED", index: 0, code: "NOT_ASSIGNED" },
  },
  exception: {
    ACK: { type: "ACK", tripId: f.trip.id, planVersion: 1, actor: f.clientEvent.actor, at: f.clientEvent.capturedAt },
    CONFLICT: f.exception,
    ISSUE: { type: "ISSUE", issue: f.issue },
    SHORT: { type: "SHORT", orderId: f.order.id, lineId: f.orderLine.id, qtyShort: 1, resolution: null },
    DAMAGED: { type: "DAMAGED", orderId: f.order.id, lineId: f.orderLine.id, qty: 1 },
    FAILED: { type: "FAILED", order: { ...f.order, status: "FAILED" } },
    PROBLEM: {
      type: "PROBLEM",
      eventId: f.clientEvent.clientEventId,
      orderId: f.order.id,
      tripId: f.trip.id,
      kind: "VEHICLE_PROBLEM",
      note: "Mock breakdown",
    },
  },
} satisfies VariantFixtures;

/** Order- and trip-scoped conflicts, including the resolution projection. */
export const apiConflictFixtures = {
  orderLevel: f.conflict,
  tripLevel: { ...f.conflict, kind: "ILLEGAL_TRANSITION", orderId: null, tripId: f.trip.id },
  resolved: { ...f.conflict, state: "RESOLVED", resolution: "ACCEPT_FACT", resolvedAt: f.clientEvent.capturedAt },
} satisfies Record<"orderLevel" | "tripLevel" | "resolved", ApiDtoInput<"conflict">>;
