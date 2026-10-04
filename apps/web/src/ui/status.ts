import type { ORDER_STATUSES, TripStatus } from "@nextdrop/contracts";

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Tone = "ok" | "warn" | "danger" | "info" | "chilled" | "deferred" | "neutral";
export const STATUS_TONES = {
  ORDERED: "neutral",
  PLANNED: "info",
  DEFERRED: "deferred",
  CANCELLED: "neutral",
  LOADED: "info",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "ok",
  FAILED: "danger",
  RECEIVED: "ok",
  DISPUTED: "danger",
} as const satisfies Record<OrderStatus, Tone>;
export const TRIP_TONES = {
  PLANNED: "info",
  READY: "ok",
  DEPARTED: "info",
  COMPLETE: "ok",
  CANCELLED: "neutral",
} as const satisfies Record<TripStatus, Tone>;
export function statusTone(status: OrderStatus): Tone {
  if (!Object.hasOwn(STATUS_TONES, status)) return "neutral";
  return STATUS_TONES[status];
}
