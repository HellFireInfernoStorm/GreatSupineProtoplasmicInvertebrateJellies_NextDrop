import {
  addDays,
  cutoffAt,
  deliveryDateFor,
  isOperatingDay,
  type Calendar,
  type CalendarDay,
  type LocalDate,
} from "@nextdrop/rules";
import { useMemo } from "react";
import { useServerNow } from "../../../lib/clock";
import { useCalendar, useCutoff, useLastWeekOrders, useOutlet, useProducts } from "../data";
import { todayOn } from "../dates";
import { draftLines, quantitiesOf, TEMPS, totalUnits, useDraft, type DraftLine, type Temp } from "./draft";

/** How many delivery dates the manager can choose from, starting tomorrow. */
const DATE_CHOICES = 5;

export interface DateOption {
  date: LocalDate;
  /** False on a non-operating day (Sunday, a holiday). */
  operating: boolean;
  /** True once the 16:00 cutoff the day before has passed. */
  closed: boolean;
}

/** The delivery dates offered, starting tomorrow on the server clock. */
export function dateOptions(today: LocalDate, nowMs: number, calendar: Calendar): DateOption[] {
  return Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, i + 1)).map((date) => ({
    date,
    operating: isOperatingDay(date, calendar),
    closed: nowMs >= cutoffAt(date),
  }));
}

/**
 * The date an order is for. The picked date holds while it is still open. Otherwise the order goes to the first
 * date that is: once the cutoff passes, the date shown rolls forward by itself.
 */
export function orderDate(picked: LocalDate | null, today: LocalDate, nowMs: number, calendar: Calendar): LocalDate {
  const open = dateOptions(today, nowMs, calendar).some((o) => o.date === picked && o.operating && !o.closed);
  return picked !== null && open ? picked : deliveryDateFor(addDays(today, 1), nowMs, calendar);
}

/**
 * Everything the place-order screens show, in one place: the outlet, the catalogue, the delivery date and its
 * cutoff, last week's quantities and the draft split into one order per temperature.
 *
 * Dates use the server clock. The rules package works out which dates are open so the screen can react at once;
 * the cutoff answer from the server stays the authority for the date an order really gets.
 */
export function useOrderModel() {
  const now = useServerNow(15_000);
  const nowMs = now.getTime();
  const firstDate = addDays(todayOn(now), 1);

  const outlet = useOutlet();
  const products = useProducts();
  const calendarDays = useCalendar(firstDate, DATE_CHOICES + 7);
  const calendar = useMemo(
    () => new Map<LocalDate, CalendarDay>((calendarDays.data ?? []).map((day) => [day.date, day])),
    [calendarDays.data],
  );

  const today = todayOn(now);
  const options = dateOptions(today, nowMs, calendar);
  const picked = useDraft((state) => state.date);
  const date = orderDate(picked, today, nowMs, calendar);

  const cutoff = useCutoff(date);
  const lastWeek = useLastWeekOrders(date);
  const lastQty = useMemo(() => quantitiesOf(lastWeek.data ?? []), [lastWeek.data]);

  const qty = useDraft((state) => state.qty);
  const catalogue = useMemo(() => products.data ?? [], [products.data]);
  const lines = Object.fromEntries(TEMPS.map((temp) => [temp, draftLines(catalogue, qty, temp)])) as Record<
    Temp,
    DraftLine[]
  >;
  const orders = TEMPS.filter((temp) => lines[temp].length > 0).map((temp) => ({ temp, lines: lines[temp] }));

  return {
    nowMs,
    outlet: outlet.data ?? null,
    products: catalogue,
    loading: outlet.isPending || products.isPending,
    failed: outlet.isError || products.isError,
    retry: () => {
      void outlet.refetch();
      void products.refetch();
    },
    options,
    /** The delivery date the order is for. */
    date,
    /** When ordering for that date closes. */
    cutoffAtMs: cutoff.data ? Date.parse(cutoff.data.cutoffAt) : cutoffAt(date),
    /** The brand ordering notice for that date, or null (ADR 0010). */
    guidanceKey: cutoff.data?.guidanceKey ?? null,
    lastQty,
    qty,
    lines,
    /** The orders a submission would make: one per temperature that has lines. */
    orders,
    units: orders.reduce((sum, order) => sum + totalUnits(order.lines), 0),
  };
}

export type OrderModel = ReturnType<typeof useOrderModel>;
