// Brand ordering notices for the store order screen (ADR 0010, ADR 0018). A notice only: it never blocks an order.
import type { Calendar, LocalDate } from "./calendar";
import { calendarDay } from "./calendar";
import type { Brand } from "./reference";

export const ORDERING_GUIDANCE_KEYS = [
  "ordering.nonOperatingDay",
  "ordering.fresh.separateChilled",
  "ordering.style.weeklyDay",
  "ordering.style.peakAhead",
  "ordering.tech.singleItems",
] as const;
export type OrderingGuidanceKey = (typeof ORDERING_GUIDANCE_KEYS)[number];

/**
 * The notice to show when a store orders `brand` goods for delivery on `date`, or null for none.
 *
 * - Any brand, non-operating date: the order rolls to the next operating day.
 * - Fresh: dry goods every trading day, chilled as a separate order, so a Fresh outlet can have two orders for one day.
 * - Style: one weekly order for the scheduled delivery day; ahead of a festival (`festivalRamp > 0`), order larger.
 * - Tech: order as needed, usually single large items.
 */
export function orderingGuidance(brand: Brand, date: LocalDate, calendar: Calendar): OrderingGuidanceKey | null {
  const day = calendarDay(date, calendar);
  if (!day.isOperating) return "ordering.nonOperatingDay";
  switch (brand) {
    case "Fresh":
      return "ordering.fresh.separateChilled";
    case "Style":
      return day.festivalRamp > 0 ? "ordering.style.peakAhead" : "ordering.style.weeklyDay";
    case "Tech":
      return "ordering.tech.singleItems";
    default:
      return null;
  }
}
