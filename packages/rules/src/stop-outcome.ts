import type { OrderStatus, StopOutcome } from "./order-reducer";

/** A driver must not record another outcome for these authoritative order states. */
export function isDriverStopTerminal(status: OrderStatus): boolean {
  const terminal: readonly OrderStatus[] = ["DELIVERED", "RECEIVED", "FAILED", "DISPUTED", "CANCELLED"];
  return terminal.includes(status);
}

export type StopOutcomeCode =
  "INVALID_DELIVERY_QUANTITY" | "INVALID_PARTIAL" | "REASON_PHOTO_REQUIRED" | "PROOF_REQUIRED";

/** Driver outcome/proof policy (ADR 0049). No I/O or wire-envelope dependencies. */
export function validateStopOutcome(input: {
  lines: readonly { id: string; qtyLoaded: number }[];
  outcome: StopOutcome;
  quantities: Readonly<Record<string, number>>;
  reason: string;
  receiver: string;
  signature?: string;
  photos: readonly string[];
}): { codes: StopOutcomeCode[]; lines: { lineId: string; qtyDelivered: number; qtyReturned: number }[] } {
  const codes: StopOutcomeCode[] = [];
  const lines = input.lines.map((line) => {
    const qtyDelivered =
      input.outcome === "FULL" ? line.qtyLoaded : input.outcome === "PARTIAL" ? input.quantities[line.id] : 0;
    return { lineId: line.id, qtyDelivered: qtyDelivered ?? NaN, qtyReturned: line.qtyLoaded - (qtyDelivered ?? NaN) };
  });
  if (
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.qtyDelivered) ||
        line.qtyDelivered < 0 ||
        line.qtyReturned < 0 ||
        !Number.isSafeInteger(line.qtyReturned),
    )
  )
    codes.push("INVALID_DELIVERY_QUANTITY");
  if (
    input.outcome === "PARTIAL" &&
    (!lines.some((line) => line.qtyDelivered > 0) || !lines.some((line) => line.qtyReturned > 0))
  )
    codes.push("INVALID_PARTIAL");
  if (input.outcome !== "FULL" && (!input.reason.trim() || !input.photos.length)) codes.push("REASON_PHOTO_REQUIRED");
  if (!input.receiver.trim() || (!input.signature && !input.photos.length)) codes.push("PROOF_REQUIRED");
  return { codes, lines };
}
