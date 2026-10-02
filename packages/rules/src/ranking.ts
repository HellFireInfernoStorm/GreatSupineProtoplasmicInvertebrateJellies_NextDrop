// Priority ranking (spec/domain/priority-policy.md, ADR 0009, ADR 0022). Lexicographic, never a weighted score.
import type { Calendar, LocalDate } from "./calendar";
import { operatingDateAfter, operatingDaysBetween } from "./calendar";
import type { PriorityClass, RulesConfig } from "./config";
import { DEFAULT_RULES_CONFIG } from "./config";
import type { PlanOrder } from "./plan";
import type { Brand } from "./reference";

/** An order with the service state the policy needs. */
export interface AllocationOrder extends PlanOrder {
  readonly brand: Brand;
  /** The date the store first asked for. Earlier than `deliveryDate` once deferred. */
  readonly requestedDate: LocalDate;
  /** How many times this order has been deferred so far. */
  readonly deferredCount: number;
  /** The outlet was deferred on the previous run (`deferred_yesterday`). */
  readonly deferredYesterday: boolean;
  /** Days since the outlet was last served (`days_since_last_served`). */
  readonly daysSinceLastServed: number;
}

/** What the ranking used, kept with every deferral as `scoreInputs`. */
export interface ScoreInputs {
  readonly priorityClass: PriorityClass;
  readonly aged: boolean;
  readonly deferredYesterday: boolean;
  readonly daysSinceLastServed: number;
  readonly deferredCount: number;
  /** Operating days from the requested date to the next serviceable date if deferred today. Class 5 only ranks by it. */
  readonly slip: number;
  readonly volumeL: number;
}

export interface RankedOrder {
  readonly order: AllocationOrder;
  /** 0 is the highest priority. */
  readonly rank: number;
  readonly scoreInputs: ScoreInputs;
}

export function priorityClassOf(order: AllocationOrder, cfg: Pick<RulesConfig, "staleServiceDays">): PriorityClass {
  if (order.brand === "Fresh") return order.temp === "chilled" ? "CHILLED_FRESH" : "OTHER_FRESH";
  if (order.deferredYesterday) return "STYLE_TECH_DEFERRED_YESTERDAY";
  if (order.daysSinceLastServed >= cfg.staleServiceDays) return "STYLE_TECH_DAYS_SINCE_SERVED";
  return "STYLE_TECH_REMAINING";
}

/** Slip of deferring the order from `date`: operating days from its requested date to the next operating date. */
export function slipOf(order: AllocationOrder, date: LocalDate, calendar: Calendar): number {
  return operatingDaysBetween(order.requestedDate, operatingDateAfter(date, calendar), calendar);
}

export function scoreInputsOf(
  order: AllocationOrder,
  cfg: Pick<RulesConfig, "staleServiceDays" | "agingDeferralCount">,
  ctx: { readonly date: LocalDate; readonly calendar: Calendar },
): ScoreInputs {
  return {
    priorityClass: priorityClassOf(order, cfg),
    aged: order.deferredCount >= cfg.agingDeferralCount,
    deferredYesterday: order.deferredYesterday,
    daysSinceLastServed: order.daysSinceLastServed,
    deferredCount: order.deferredCount,
    slip: slipOf(order, ctx.date, ctx.calendar),
    volumeL: order.volumeL,
  };
}

/**
 * Orders by the policy, highest priority first:
 * 1. class in `cfg.priorityOrder` (chilled Fresh, other Fresh, Style/Tech deferred yesterday, Style/Tech not served for
 *    `staleServiceDays`, remaining Style/Tech);
 * 2. aging guard: deferred `agingDeferralCount` times or more sorts first within its class;
 * 3. class 5: larger slip first; other classes: deferred yesterday first, then most days since last served;
 * 4. tie-break: larger volume, then order id.
 */
export function rankOrders(
  orders: readonly AllocationOrder[],
  cfg: RulesConfig = DEFAULT_RULES_CONFIG,
  ctx: { readonly date: LocalDate; readonly calendar: Calendar },
): RankedOrder[] {
  const classRank = new Map(cfg.priorityOrder.map((c, i) => [c, i]));
  const keyed = orders.map((order) => ({ order, s: scoreInputsOf(order, cfg, ctx) }));
  keyed.sort((a, b) => {
    const ca = classRank.get(a.s.priorityClass) ?? 99;
    const cb = classRank.get(b.s.priorityClass) ?? 99;
    if (ca !== cb) return ca - cb;
    if (a.s.aged !== b.s.aged) return a.s.aged ? -1 : 1;
    if (a.s.priorityClass === "STYLE_TECH_REMAINING") {
      if (a.s.slip !== b.s.slip) return b.s.slip - a.s.slip;
    } else {
      if (a.s.deferredYesterday !== b.s.deferredYesterday) return a.s.deferredYesterday ? -1 : 1;
      if (a.s.daysSinceLastServed !== b.s.daysSinceLastServed) return b.s.daysSinceLastServed - a.s.daysSinceLastServed;
    }
    if (a.s.volumeL !== b.s.volumeL) return b.s.volumeL - a.s.volumeL;
    return a.order.id < b.order.id ? -1 : a.order.id > b.order.id ? 1 : 0;
  });
  return keyed.map((k, rank) => ({ order: k.order, rank, scoreInputs: k.s }));
}
