import type { ApiDto, ApiDtoInput } from "@nextdrop/contracts";

// What the receipt and issue screens send. Pure.

type Order = ApiDto<"order">;
export type IssueKind = ApiDtoInput<"reportIssueRequest">["kind"];
export const ISSUE_KINDS = ["SHORT", "DAMAGED", "WARM", "OTHER"] as const satisfies readonly IssueKind[];

/** The manager's count for each line: what they entered, or the driver's delivered quantity until they change it. */
export function receivedQty(order: Order, counted: Readonly<Record<string, number>>, lineId: string): number {
  return counted[lineId] ?? order.lines.find((line) => line.id === lineId)?.qtyDelivered ?? 0;
}

/** True while every line still matches the driver's record. */
export function asDelivered(order: Order, counted: Readonly<Record<string, number>>): boolean {
  return order.lines.every((line) => receivedQty(order, counted, line.id) === line.qtyDelivered);
}

export function receiptRequest(order: Order, counted: Readonly<Record<string, number>>): ApiDtoInput<"receiptRequest"> {
  return { lines: order.lines.map((line) => ({ lineId: line.id, qtyReceived: receivedQty(order, counted, line.id) })) };
}

/** An issue about one line and a quantity, or about the whole order when no line is chosen. */
export function issueRequest(
  kind: IssueKind,
  lineId: string | null,
  qty: number,
  note: string,
): ApiDtoInput<"reportIssueRequest"> {
  const text = note.trim();
  return {
    kind,
    ...(lineId ? { lines: [{ lineId, qty }] } : {}),
    ...(text ? { note: text } : {}),
  };
}

/** An issue can be reported once the delivery has been made, and again after that: each report is its own dispute. */
export const canReport = (status: Order["status"]): boolean =>
  status === "DELIVERED" || status === "RECEIVED" || status === "DISPUTED";
