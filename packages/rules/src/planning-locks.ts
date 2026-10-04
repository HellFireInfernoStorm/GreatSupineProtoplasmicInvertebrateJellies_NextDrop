import { sequenceStops } from "./etas";
import type { Plan } from "./validator";
import type { ReferenceData } from "./reference";

/** Canonical published placement and server fact lock (ADR 0053). Sequence is 1-based. */
export interface PublishedStop {
  readonly orderId: string;
  readonly vehicleId: string;
  readonly tripNo: number;
  readonly seq: number;
  readonly locked: boolean;
  readonly departed: boolean;
}

export type StopPlacement = Pick<PublishedStop, "orderId" | "vehicleId" | "tripNo" | "seq">;

/** Compare locks against the delivery sequence that schedules and publish actually use. */
export function stopPlacements(plan: Pick<Plan, "trips">, ref: Pick<ReferenceData, "outlets">): StopPlacement[] {
  return plan.trips.flatMap((trip) => {
    // Invalid drafts still need validator diagnostics rather than an unknown-outlet exception here.
    const orders = trip.orders.every((order) => ref.outlets.has(order.outletId))
      ? sequenceStops(trip, ref)
      : trip.orders;
    return orders.map((order, index) => ({
      orderId: order.id,
      vehicleId: trip.vehicleId,
      tripNo: trip.tripNo,
      seq: index + 1,
    }));
  });
}

/** Only departed published trips retain dispatcher draft order (ADR 0053). */
export function preserveDraftOrder(
  trip: Pick<PublishedStop, "vehicleId" | "tripNo">,
  publishedStops: readonly PublishedStop[] = [],
): boolean {
  return publishedStops.some(
    (stop) => stop.departed && stop.vehicleId === trip.vehicleId && stop.tripNo === trip.tripNo,
  );
}

/** First illegal edit, or null. Departed cargo may only leave or move later on its original trip. */
export function lockedStopChange(current: readonly PublishedStop[], next: readonly StopPlacement[]): string | null {
  const placements = new Map(next.map((stop) => [stop.orderId, stop]));
  for (const stop of current) {
    const after = placements.get(stop.orderId);
    const sameTrip = after?.vehicleId === stop.vehicleId && after.tripNo === stop.tripNo;
    if (stop.locked && !sameTrip) return stop.orderId;
    if (stop.locked && after) {
      // Relative order survives removing earlier unlocked stops, regardless of input row order.
      const crossed = current.some((other) => {
        if (other.vehicleId !== stop.vehicleId || other.tripNo !== stop.tripNo) return false;
        const placement = placements.get(other.orderId);
        if (!placement || other.seq <= stop.seq) return false;
        return (other.locked || other.departed) && placement.seq <= after.seq;
      });
      if (crossed) return stop.orderId;
    }
    if (stop.departed && after && !sameTrip) return stop.orderId;
  }
  const cargo = new Map(current.map((stop) => [stop.orderId, stop]));
  for (const stop of next) {
    if (current.some((s) => s.departed && s.vehicleId === stop.vehicleId && s.tripNo === stop.tripNo)) {
      const before = cargo.get(stop.orderId);
      if (!before || before.vehicleId !== stop.vehicleId || before.tripNo !== stop.tripNo) return stop.orderId;
    }
  }
  return null;
}
