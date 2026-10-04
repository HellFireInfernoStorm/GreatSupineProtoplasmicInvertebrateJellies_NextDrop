import type { ApiDto } from "@nextdrop/contracts";

// What My deliveries shows, worked out from `GET /store/deliveries`. Pure, so it can be tested without a screen.

export type Delivery = ApiDto<"deliveriesResponse">["items"][number];
export type Order = Delivery["order"];
type Line = Order["lines"][number];

const LOADED_OR_LATER: readonly Order["status"][] = ["LOADED", "OUT_FOR_DELIVERY", "DELIVERED", "RECEIVED", "DISPUTED"];
const HANDED_OVER: readonly Order["status"][] = ["DELIVERED", "RECEIVED", "DISPUTED"];
const CLOSED: readonly Order["status"][] = ["RECEIVED", "DISPUTED", "CANCELLED", "FAILED"];

/** Units short at the dock on a line, from the loader's flags. */
export function shortOn(order: Order, line: Line): number {
  return order.flags.short.filter((flag) => flag.lineId === line.id).reduce((sum, flag) => sum + flag.qtyShort, 0);
}

/**
 * What the store should expect on a line: the driver's count once delivered, the loader's count once loaded, and
 * before that the order less anything the dock has already flagged short.
 */
export function expectedQty(order: Order, line: Line): number {
  if (HANDED_OVER.includes(order.status)) return line.qtyDelivered;
  if (LOADED_OR_LATER.includes(order.status)) return line.qtyLoaded;
  return Math.max(0, line.qtyOrdered - shortOn(order, line));
}

export function orderUnits(order: Order): { ordered: number; expected: number; short: number } {
  const ordered = order.lines.reduce((sum, line) => sum + line.qtyOrdered, 0);
  const expected = order.lines.reduce((sum, line) => sum + expectedQty(order, line), 0);
  return { ordered, expected, short: Math.max(0, ordered - expected) };
}

/**
 * How far along an order is, from 0 to 1. The server gives a store only its own stop of a trip, so the bar follows the
 * order's own stages and not the run's stop count (ADR 0041).
 */
const STAGE: Partial<Record<Order["status"], number>> = {
  PLANNED: 0.25,
  LOADED: 0.5,
  OUT_FOR_DELIVERY: 0.75,
  DELIVERED: 1,
  RECEIVED: 1,
  DISPUTED: 1,
};
export const stageProgress = (status: Order["status"]): number => STAGE[status] ?? 0;

export type RunState = "planned" | "onway" | "nosignal" | "delivered" | "closed";

/** One vehicle visit to the store: the orders that arrive together on a trip. */
export interface Run {
  trip: NonNullable<Delivery["trip"]>;
  orders: Order[];
  /** The store's stop number on the trip. */
  seq: number;
  etaFrom: string;
  etaTo: string;
  /** The least advanced order's status: the run is only as far along as its slowest order. */
  status: Order["status"];
  state: RunState;
  lastHeardAt: string | null;
  /** When the driver recorded the delivery on the phone, and when the server received that record. */
  deliveredAt: string | null;
  confirmedAt: string | null;
}

/** Groups the day's deliveries by trip. Orders with no trip yet (not planned, or deferred) make no run. */
export function runsOf(items: readonly Delivery[]): Run[] {
  const byTrip = new Map<string, Delivery[]>();
  for (const item of items) {
    if (!item.trip || !item.order.assignment) continue;
    byTrip.set(item.trip.id, [...(byTrip.get(item.trip.id) ?? []), item]);
  }
  return [...byTrip.values()]
    .map((group): Run => {
      const first = group[0]!;
      const orders = group.map((item) => item.order);
      const status = orders.reduce(
        (least, order) => (stageProgress(order.status) < stageProgress(least) ? order.status : least),
        orders[0]!.status,
      );
      const stops = first.trip!.stops.filter((stop) => orders.some((order) => order.id === stop.order.id));
      const latest = (values: (string | null)[]) =>
        values
          .filter((v) => v !== null)
          .sort()
          .at(-1) ?? null;
      const handedOver = orders.some((order) => order.status === "DELIVERED");
      const silent = group.some((item) => item.signal === "NO_SIGNAL");
      return {
        trip: first.trip!,
        orders,
        seq: Math.min(...orders.map((order) => order.assignment!.seq)),
        etaFrom: orders.map((order) => order.assignment!.etaFrom).sort()[0]!,
        etaTo: orders
          .map((order) => order.assignment!.etaTo)
          .sort()
          .at(-1)!,
        status,
        state: orders.every((order) => CLOSED.includes(order.status))
          ? "closed"
          : handedOver
            ? "delivered"
            : silent
              ? "nosignal"
              : status === "OUT_FOR_DELIVERY"
                ? "onway"
                : "planned",
        lastHeardAt: latest(group.map((item) => item.lastHeardAt)),
        deliveredAt: latest(stops.map((stop) => stop.deliveredAt)),
        confirmedAt: latest(stops.map((stop) => stop.confirmedAt)),
      };
    })
    .sort((a, b) => a.etaFrom.localeCompare(b.etaFrom));
}

/** The run the hero card is about: the first one still open, or the day's last run once everything is closed. */
export function heroRun(runs: readonly Run[]): Run | null {
  return runs.find((run) => run.state !== "closed") ?? runs.at(-1) ?? null;
}

/** The order whose receipt can be confirmed now: the driver's delivery record has reached the server. */
export function confirmable(run: Run): Order | null {
  return run.orders.find((order) => order.status === "DELIVERED") ?? null;
}

export type Alert =
  | { kind: "partial"; order: Order; ordered: number; expected: number; short: number }
  | { kind: "deferred"; order: Order; deferral: NonNullable<Order["deferral"]> };

/** What the manager should know before the truck arrives: orders coming short, and orders that were moved. */
export function alertsOf(orders: readonly Order[]): Alert[] {
  return orders.flatMap((order): Alert[] => {
    const alerts: Alert[] = [];
    const units = orderUnits(order);
    const arrived = HANDED_OVER.includes(order.status) || CLOSED.includes(order.status);
    if (units.short > 0 && !arrived) alerts.push({ kind: "partial", order, ...units });
    if (order.deferral && !arrived) {
      alerts.push({ kind: "deferred", order, deferral: order.deferral });
    }
    return alerts;
  });
}
