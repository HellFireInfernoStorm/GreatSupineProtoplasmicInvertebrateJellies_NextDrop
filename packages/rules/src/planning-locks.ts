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

/** First illegal edit, or null. Departed cargo may only leave or move later on its original trip. */
export function lockedStopChange(current: readonly PublishedStop[], next: readonly StopPlacement[]): string | null {
  const placements = new Map(next.map((stop) => [stop.orderId, stop]));
  for (const stop of current) {
    const after = placements.get(stop.orderId);
    const sameTrip = after?.vehicleId === stop.vehicleId && after.tripNo === stop.tripNo;
    if (stop.locked && (!sameTrip || after?.seq !== stop.seq)) return stop.orderId;
    if (stop.departed && after) {
      const lastLocked = Math.max(
        0,
        ...current
          .filter((s) => s.locked && s.vehicleId === stop.vehicleId && s.tripNo === stop.tripNo)
          .map((s) => s.seq),
      );
      if (!sameTrip || (!stop.locked && after.seq !== stop.seq && after.seq <= lastLocked)) return stop.orderId;
    }
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
