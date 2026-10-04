import type { ApiDto, EventEnvelope } from "@nextdrop/contracts";

// An order's timeline as the Store shows it, worked out from the events of `GET /store/orders/:id`. Pure.

export type OrderDetail = ApiDto<"orderDetail">;
// The zod type of a timeline entry is not narrowed by `type`; the envelope type is, and the client has checked it.
type Event = EventEnvelope;
type Order = OrderDetail["order"];

export type StepKind =
  | "ordered"
  | "deferred"
  | "planned"
  | "planChanged"
  | "short"
  | "damaged"
  | "loaded"
  | "out"
  | "arrived"
  | "delivered"
  | "refused"
  | "failed"
  | "proof"
  | "received"
  | "issue"
  | "issueResolved"
  | "cancelled";

export interface Step {
  id: string;
  kind: StepKind;
  /** What the step's text needs: counts, and the codes and instants the screen turns into words. */
  params: Record<string, string | number>;
  role: Event["actor"]["role"];
  /** When it happened where it happened, and when the server received it. For a field fact these differ. */
  capturedAt: string;
  confirmedAt: string;
}

const sum = (values: readonly (number | undefined)[]) => values.reduce<number>((total, v) => total + (v ?? 0), 0);

function describe(event: Event): Pick<Step, "kind" | "params"> | null {
  switch (event.type) {
    case "ORDER_PLACED":
      return { kind: "ordered", params: { count: sum(event.payload.lines.map((line) => line.qty)) } };
    case "ORDER_DEFERRED":
      return { kind: "deferred", params: { toDate: event.payload.toDate, reasonCode: event.payload.reasonCode } };
    case "ORDER_PLANNED":
      return { kind: "planned", params: { etaFrom: event.payload.etaFrom, etaTo: event.payload.etaTo } };
    case "PLAN_CHANGED":
      return { kind: "planChanged", params: { etaFrom: event.payload.to.etaFrom, etaTo: event.payload.to.etaTo } };
    case "LOAD_SHORT":
      return { kind: "short", params: { count: sum(event.payload.lines.map((line) => line.qtyShort)) } };
    case "LOAD_DAMAGED":
      return { kind: "damaged", params: { count: sum(event.payload.lines.map((line) => line.qty)) } };
    case "LOAD_CONFIRMED":
      return { kind: "loaded", params: { count: sum(event.payload.lines.map((line) => line.qtyLoaded)) } };
    case "ORDER_OUT_FOR_DELIVERY":
      return { kind: "out", params: {} };
    case "STOP_ARRIVED":
      return { kind: "arrived", params: {} };
    case "STOP_OUTCOME": {
      if (event.payload.outcome === "REFUSED") return { kind: "refused", params: {} };
      if (event.payload.outcome === "FAILED") return { kind: "failed", params: {} };
      return {
        kind: "delivered",
        params: { count: sum((event.payload.lines ?? []).map((line) => line.qtyDelivered)) },
      };
    }
    case "POD_CAPTURED":
      return {
        kind: "proof",
        params: { name: event.payload.receiverName, count: event.payload.photoBlobRefs.length },
      };
    case "RECEIPT_CONFIRMED":
      return { kind: "received", params: { count: sum(event.payload.lines.map((line) => line.qtyReceived)) } };
    case "ISSUE_REPORTED":
      return { kind: "issue", params: { issueKind: event.payload.kind } };
    case "ISSUE_RESOLVED":
      return { kind: "issueResolved", params: { resolution: event.payload.resolution } };
    case "ORDER_CANCELLED":
      return { kind: "cancelled", params: {} };
    default:
      // Plan acknowledgements, trip and vehicle events and sync clashes are not the store's to read.
      return null;
  }
}

/** The steps to show, oldest first. An event the server is still holding for the dispatcher is left out. */
export function timelineSteps(timeline: OrderDetail["timeline"]): Step[] {
  return (timeline as readonly Event[])
    .filter((event) => event.disposition === "APPLIED")
    .flatMap((event): Step[] => {
      const described = describe(event);
      if (!described) return [];
      return [
        {
          id: event.id,
          ...described,
          role: event.actor.role,
          capturedAt: event.capturedAt,
          confirmedAt: event.receivedAt,
        },
      ];
    })
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** The status words every role shares, in order (Figma `232:587`). */
export const TRACK_STAGES = ["ordered", "planned", "loaded", "out", "delivered", "closed"] as const;

const DONE: Record<Order["status"], number> = {
  ORDERED: 1,
  DEFERRED: 1,
  CANCELLED: 1,
  PLANNED: 2,
  LOADED: 3,
  OUT_FOR_DELIVERY: 4,
  FAILED: 4,
  DELIVERED: 5,
  RECEIVED: 6,
  DISPUTED: 6,
};
/** How many of the six stages an order has passed. */
export const stagesDone = (status: Order["status"]): number => DONE[status];
