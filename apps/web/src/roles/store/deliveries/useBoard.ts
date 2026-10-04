import { useServerNow } from "../../../lib/clock";
import { useDeferredOrders, useDeliveries } from "../data";
import { todayOn } from "../dates";
import { useOrderModel } from "../order/useOrderModel";
import { heroRun, runsOf, type Order } from "./model";

/**
 * The orders a store manager is following: today's deliveries, the next delivery day's, and anything deferred.
 * My deliveries and Order tracking read the same board, so they never disagree.
 */
export function useBoard() {
  const now = useServerNow(60_000);
  const today = todayOn(now);
  const model = useOrderModel();
  const nextDay = model.options.find((option) => option.operating)?.date ?? model.date;

  const deliveries = useDeliveries(today);
  const upcoming = useDeliveries(nextDay);
  const deferred = useDeferredOrders();

  const items = deliveries.data?.items ?? [];
  const orders = items.map((item) => item.order);
  const nextItems = upcoming.data?.items ?? [];
  // The next delivery day's orders, with any order that was moved off it.
  const later: Order[] = nextItems.map((item) => item.order);
  for (const order of deferred.data ?? []) {
    if (![...later, ...orders].some((other) => other.id === order.id)) later.push(order);
  }
  const runs = runsOf(items);
  return {
    now,
    today,
    nextDay,
    /** The place-order model: the next order's date and cutoff. */
    model,
    loading: deliveries.isPending,
    failed: deliveries.isError,
    refreshing: deliveries.isFetching,
    refresh: () => void deliveries.refetch(),
    /** Today's deliveries, as the server lists them. */
    items,
    orders,
    /** The next delivery day's deliveries. */
    nextItems,
    /** Today's run for the hero card, or null. */
    run: heroRun(runs),
    /** The next delivery day's run, if it is planned. */
    nextRun: heroRun(runsOf(nextItems)),
    later,
  };
}

export type Board = ReturnType<typeof useBoard>;
