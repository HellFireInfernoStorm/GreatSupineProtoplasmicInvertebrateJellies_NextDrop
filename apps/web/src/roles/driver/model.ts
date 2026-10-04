import { isDriverStopTerminal, validateStopOutcome } from "@nextdrop/rules";
import type { ApiDto, ClientEvent, TripDto } from "@nextdrop/contracts";
import type { FieldReceipt, OutboxEntry, LocalConflict } from "../../sync/database";
import type { EventIntent, FieldRepository } from "../../sync/repository";

export type Stop = ApiDto<"stop">;
export type Group = { trip: TripDto; stops: Stop[] };
export function groupStops(trips: TripDto[]): Group[] {
  const groups: Group[] = [];
  for (const trip of [...trips].sort((a, b) => a.tripNo - b.tripNo)) {
    for (const stop of [...trip.stops].sort((a, b) => a.seq - b.seq)) {
      const last = groups.at(-1);
      if (last?.trip.id === trip.id && last.stops[0]!.outlet.id === stop.outlet.id) last.stops.push(stop);
      else groups.push({ trip, stops: [stop] });
    }
  }
  return groups;
}
export const projected = (entry: OutboxEntry) => ["pending", "sending", "acked"].includes(entry.state);
export const deliveryKey = (userId: string, epoch: number, date: string, orderId: string) =>
  `${userId}:${epoch}:${date}:${orderId}`;
export function receiptEvents(receipt: FieldReceipt, outbox: OutboxEntry[]): OutboxEntry[] {
  return receipt.events.map((event) => outbox.find((row) => row.clientEventId === event.clientEventId) ?? event);
}
export function deliveryDone(stop: Stop, receipt: FieldReceipt | undefined, outbox: OutboxEntry[]): boolean {
  if (isDriverStopTerminal(stop.order.status)) return true;
  if (receipt) {
    const events = receiptEvents(receipt, outbox);
    return (
      events.some((e) => e.type === "STOP_OUTCOME" && projected(e)) &&
      events.some((e) => e.type === "POD_CAPTURED" && projected(e))
    );
  }
  return false;
}
export function savedDeliveryCount(receipts: FieldReceipt[], outbox: OutboxEntry[]): number {
  return receipts.filter(
    (r) =>
      r.kind === "DELIVERY" && receiptEvents(r, outbox).some((e) => ["pending", "sending", "held"].includes(e.state)),
  ).length;
}
export function deliveryIntents(input: {
  stop: Stop;
  trip: TripDto;
  userId: string;
  outcome: "FULL" | "PARTIAL" | "REFUSED" | "FAILED";
  quantities: Record<string, number>;
  reason: string;
  receiver: string;
  signature?: string;
  photos: string[];
}): EventIntent[] {
  const { stop, trip, outcome, userId } = input;
  const { lines, codes } = validateStopOutcome({ ...input, lines: stop.order.lines });
  if (codes.length) throw new Error(codes.join(", "));
  const subject = { orderId: stop.order.id, tripId: trip.id, vehicleId: trip.vehicleId };
  const actor = { userId, role: "DRIVER" as const };
  return [
    {
      type: "STOP_OUTCOME",
      subject,
      actor,
      payload: { outcome, lines, ...(outcome !== "FULL" ? { reasonCode: input.reason } : {}) },
    },
    {
      type: "POD_CAPTURED",
      subject,
      actor,
      payload: {
        receiverName: input.receiver.trim(),
        ...(input.signature ? { signatureBlobRef: input.signature } : {}),
        photoBlobRefs: input.photos,
      },
      blobRefs: [...input.photos, ...(input.signature ? [input.signature] : [])],
    },
  ];
}
export async function saveDelivery(
  repository: FieldRepository,
  receipt: Omit<FieldReceipt, "events">,
  intents: EventIntent[],
) {
  return repository.enqueueBatch(intents, receipt);
}
export function capturedTime(event: Pick<ClientEvent, "capturedAt" | "clockOffsetMs">): string {
  return new Date(Date.parse(event.capturedAt) + (event.clockOffsetMs ?? 0)).toISOString();
}

export const mapsUrl = (address: string | null, name: string, district: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([address ?? name, district, "Sri Lanka"].join(", "))}`;

/** Synced means server receipt; a held fact remains inert and visibly awaits dispatch. */
export function heldContextReady(events: OutboxEntry[], conflicts: LocalConflict[]): boolean {
  return events
    .filter((e) => e.state === "held")
    .every((e) => !!e.confirmedAt && conflicts.some((c) => c.clientEventId === e.clientEventId && !!c.context));
}
export function recordsReceived(
  state: {
    offline: boolean;
    syncing: boolean;
    error: string | null;
    pendingCount: number;
    heldCount: number;
    confirmationCount: number;
    failedCount: number;
    lastSyncedAt: string | null;
  },
  events: OutboxEntry[],
  conflicts: LocalConflict[],
): boolean {
  return (
    !state.offline &&
    !state.syncing &&
    !state.error &&
    !state.pendingCount &&
    !state.confirmationCount &&
    !state.failedCount &&
    !!state.lastSyncedAt &&
    events.filter((e) => e.state === "held").length === state.heldCount &&
    !events.some((e) => e.state === "acked") &&
    heldContextReady(events, conflicts)
  );
}
