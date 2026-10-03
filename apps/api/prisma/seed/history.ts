// Prior state the planner and the capacity outlook read (seed-and-demo.md §15.1 items 4, 6 and 7): outlet service
// state and about 12 weeks of aggregated weekly demand. Pure and deterministic.
import {
  addDays,
  BRANDS,
  isOperatingDay,
  isoWeekOf,
  type Brand,
  type LocalDate,
  type ReferenceData,
} from "@nextdrop/rules";
import { quantitiesOf, type OrderSpec } from "./orders";
import { prng } from "./peak-day";
import { STORY_DATE } from "./story-fixtures";

export const HISTORY_WEEKS = 12;
const HISTORY_SEED = 12;

export interface ServiceStateSpec {
  /** Outlet display ID. */
  readonly outletId: string;
  readonly lastServedDate: LocalDate;
  /** The outlet had an order deferred on the previous run (`deferred_yesterday`). */
  readonly deferredLastRun: boolean;
}

export interface WeeklyDemandSpec {
  readonly depot: string;
  readonly brand: Brand;
  readonly isoYear: number;
  readonly isoWeek: number;
  /** m³, 3 decimal places. */
  readonly totalVolumeM3: string;
  readonly chilledVolumeM3: string;
}

/** The latest operating day at least `days` days before `date`. */
function operatingDayBefore(date: LocalDate, days: number, ref: ReferenceData): LocalDate {
  let d = addDays(date, -days);
  while (!isOperatingDay(d, ref.calendar)) d = addDays(d, -1);
  return d;
}

/**
 * One row per outlet. An outlet whose story-day order was carried over from yesterday's run is `deferredLastRun` and
 * was last served 3 to 8 days ago; any other outlet was served 1 to 12 days ago.
 */
export function generateServiceState(ref: ReferenceData, orders: readonly OrderSpec[]): ServiceStateSpec[] {
  const rnd = prng(HISTORY_SEED);
  const deferredYesterday = new Set(
    orders.filter((o) => o.deferrals.at(-1)?.toDate === STORY_DATE).map((o) => o.outletId),
  );
  return [...ref.outlets.keys()].sort().map((outletId) => {
    const deferred = deferredYesterday.has(outletId);
    const days = deferred ? 3 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 12);
    return { outletId, lastServedDate: operatingDayBefore(STORY_DATE, days, ref), deferredLastRun: deferred };
  });
}

/**
 * `HISTORY_WEEKS` ISO weeks before the story week, per depot and brand. A normal week is six days at three quarters of
 * the depot's story-day volume, with ±10 % noise and a gentle rise into the peak. Kandy has no bulk peak day, so its
 * scale follows its share of outlets.
 */
export function generateWeeklyHistory(ref: ReferenceData, orders: readonly OrderSpec[]): WeeklyDemandSpec[] {
  const rnd = prng(HISTORY_SEED + 1);
  const depotOf = (outletId: string) => ref.outlets.get(outletId)?.depot;
  const outletCount = (depot: string) => [...ref.outlets.values()].filter((o) => o.depot === depot).length;
  const peakDepot = "Peliyagoda";

  const day = new Map<string, { total: number; chilled: number }>();
  for (const order of orders) {
    if (order.deliveryDate !== STORY_DATE || depotOf(order.outletId) !== peakDepot) continue;
    const key = order.brand;
    const m3 = quantitiesOf(order).volumeL / 1000;
    const cur = day.get(key) ?? { total: 0, chilled: 0 };
    day.set(key, { total: cur.total + m3, chilled: cur.chilled + (order.temp === "chilled" ? m3 : 0) });
  }

  const depots = [...new Set([...ref.districts.values()].map((d) => d.depot))].sort();
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, i) =>
    isoWeekOf(addDays(STORY_DATE, -7 * (HISTORY_WEEKS - i))),
  );
  const rows: WeeklyDemandSpec[] = [];
  for (const depot of depots) {
    const scale = outletCount(depot) / outletCount(peakDepot);
    for (const brand of BRANDS) {
      const base = day.get(brand) ?? { total: 0, chilled: 0 };
      weeks.forEach((week, i) => {
        const factor = 6 * 0.75 * scale * (0.9 + 0.2 * rnd()) * (0.92 + (0.08 * i) / (HISTORY_WEEKS - 1));
        rows.push({
          depot,
          brand,
          ...week,
          totalVolumeM3: (base.total * factor).toFixed(3),
          chilledVolumeM3: (base.chilled * factor).toFixed(3),
        });
      });
    }
  }
  return rows;
}
