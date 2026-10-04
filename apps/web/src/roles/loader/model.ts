import {
  applyEvent,
  orderChecklistReadiness,
  tripChecklistReadiness,
  type OrderEvent,
  type OrderState,
} from "@nextdrop/rules";
import { loadDamagedReasonCodeSchema, type ApiDto, type TripDto } from "@nextdrop/contracts";
import type { EventIntent } from "../../sync/repository";
import type { LoadDraft } from "./drafts";
import type { FieldReceipt, OutboxEntry } from "../../sync/database";
export const receiptMatches = (receipt: Pick<FieldReceipt, "id">, prefix: string) =>
  receipt.id === prefix || receipt.id.startsWith(`${prefix}:`);
export function latestReceipt(receipts: FieldReceipt[], prefix: string): FieldReceipt | undefined {
  return receipts
    .filter((r) => receiptMatches(r, prefix))
    .sort((a, b) => (b.events[0]?.deviceSeq ?? -1) - (a.events[0]?.deviceSeq ?? -1))[0];
}
/** Retry only a wholly rejected/failed attempt; pending, held or accepted facts remain immutable. */
export function canRetry(receipt: FieldReceipt, events: OutboxEntry[]): boolean {
  return (
    receipt.events.length > 0 &&
    receipt.events.every((saved) => {
      const event = events.find((e) => e.clientEventId === saved.clientEventId) ?? saved;
      return event.state === "rejected" || event.state === "failed";
    })
  );
}
/** A completed attempt no longer blocks a later reversal request for the same order. */
export function receiptCovered(receipt: FieldReceipt, events: OutboxEntry[], feedCursor: string): boolean {
  return (
    receipt.events.length > 0 &&
    receipt.events.every((saved) => {
      const event = events.find((e) => e.clientEventId === saved.clientEventId) ?? saved;
      return (
        event.state === "acked" &&
        event.confirmationFeedHead !== undefined &&
        BigInt(event.confirmationFeedHead) <= BigInt(feedCursor)
      );
    })
  );
}
export type Stop = ApiDto<"stop">;
export type Line = Stop["order"]["lines"][number];
export const loadOrder = (trip: TripDto) => [...trip.stops].sort((a, b) => b.seq - a.seq);
export const checklistLines = (stop: Stop) =>
  stop.order.lines.map((line) => ({ lineId: line.id, qtyOrdered: line.qtyOrdered }));
export function projectDrafts(state: OrderState, drafts: LoadDraft[]): OrderState {
  for (const draft of drafts)
    for (const intent of draft.intents)
      if (intent.subject.orderId === state.orderId)
        state = applyEvent(state, { ...intent, id: draft.receipt.id } as OrderEvent).state;
  return state;
}
export const orderGate = (stop: Stop, state: OrderState) =>
  orderChecklistReadiness(stop.order.id, checklistLines(stop), state);
export const tripGate = (trip: TripDto, states: Record<string, OrderState>) =>
  tripChecklistReadiness(
    trip.stops.map((stop) => ({
      orderId: stop.order.id,
      lines: checklistLines(stop),
      state: states[stop.order.id]!,
    })),
  );
export function loadIntents(input: {
  stop: Stop;
  trip: TripDto;
  line: Line;
  state: OrderState;
  userId: string;
  kind: "loaded" | "short" | "damaged";
  quantity?: number;
  reason?: string;
  photoRef?: string;
}): EventIntent[] {
  const { stop, trip, line, state, userId, kind, reason, photoRef } = input;
  const missing = orderGate(stop, state).incompleteLines.find((l) => l.lineId === line.id)?.missing ?? 0;
  const quantity = kind === "loaded" ? 0 : (input.quantity ?? 0);
  if (
    !missing ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    quantity > missing ||
    (kind !== "loaded" && (!quantity || !reason)) ||
    (kind === "damaged" && !photoRef)
  )
    throw new Error("Invalid load report");
  const subject = { orderId: stop.order.id, tripId: trip.id, vehicleId: trip.vehicleId };
  const actor = { userId, role: "LOADER" as const };
  const intents: EventIntent[] = [];
  if (kind === "short")
    intents.push({
      type: "LOAD_SHORT",
      subject,
      actor,
      payload: {
        lines: [{ lineId: line.id, qtyShort: quantity }],
        reasonCode: reason!,
        ...(photoRef ? { photoRef } : {}),
      },
      blobRefs: photoRef ? [photoRef] : [],
    });
  if (kind === "damaged")
    intents.push({
      type: "LOAD_DAMAGED",
      subject,
      actor,
      payload: {
        lines: [{ lineId: line.id, qty: quantity }],
        reasonCode: loadDamagedReasonCodeSchema.parse(reason),
        photoRef: photoRef!,
      },
      blobRefs: [photoRef!],
    });
  const loaded = (state.loaded.find((l) => l.lineId === line.id)?.qtyLoaded ?? 0) + missing - quantity;
  // A report accounts for the missing/damaged units and confirms the remaining physical load.
  if (loaded > 0)
    intents.push({
      type: "LOAD_CONFIRMED",
      subject,
      actor,
      payload: { lines: [{ lineId: line.id, qtyLoaded: loaded }] },
    });
  return intents;
}
export function loadTotals(trip: TripDto, states: Record<string, OrderState>) {
  let weight = 0,
    volume = 0,
    loaded = 0,
    short = 0,
    damaged = 0;
  for (const stop of trip.stops) {
    const state = states[stop.order.id];
    if (!state) continue;
    for (const line of stop.order.lines) {
      const quantity = state.loaded.find((l) => l.lineId === line.id)?.qtyLoaded ?? 0;
      loaded += quantity;
      weight += (quantity * line.unitWeightG) / 1000;
      volume += quantity * line.unitVolumeM3;
    }
    short += state.short.reduce((sum, line) => sum + line.qtyShort, 0);
    damaged += state.damaged.reduce((sum, line) => sum + line.qty, 0);
  }
  return { weight, volume, loaded, short, damaged };
}
