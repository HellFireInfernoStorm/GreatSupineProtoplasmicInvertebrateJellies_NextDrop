import type { Prisma } from "../../generated/prisma/client";
import type { OrderRecord } from "../orders";

interface FactLines {
  lines?: { lineId: string; qtyLoaded?: number; qtyDelivered?: number }[];
  outcome?: string;
}

/** A delivering stop outcome: the order counts as delivered (ADR 0019). */
export const isDelivering = (type: string, payload: unknown) =>
  type === "STOP_OUTCOME" && ["FULL", "PARTIAL"].includes(String((payload as FactLines).outcome));

/**
 * Line quantities a field fact projects onto the order: `LOAD_CONFIRMED` sets loaded quantities, a `STOP_OUTCOME`
 * delivered ones. Shared by ingest and by an accepted held fact (ADR 0040).
 */
export async function projectFact(tx: Prisma.TransactionClient, order: OrderRecord, type: string, payload: unknown) {
  const fact = payload as FactLines;
  if (type === "LOAD_CONFIRMED") {
    for (const line of fact.lines ?? []) {
      if (line.qtyLoaded === undefined) continue;
      await tx.orderLine.update({ where: { id: line.lineId }, data: { qtyLoaded: line.qtyLoaded } });
    }
  }
  if (type === "STOP_OUTCOME") {
    const reported = new Map((fact.lines ?? []).map((l) => [l.lineId, l.qtyDelivered]));
    for (const line of order.orderLine_orderId) {
      // A FULL delivery without line detail delivers what was loaded (or ordered, if loading was not recorded).
      const qty =
        reported.get(line.id) ??
        (fact.outcome === "FULL" ? (line.qtyLoaded > 0 ? line.qtyLoaded : line.qtyOrdered) : undefined);
      if (qty !== undefined) await tx.orderLine.update({ where: { id: line.id }, data: { qtyDelivered: qty } });
    }
  }
}
