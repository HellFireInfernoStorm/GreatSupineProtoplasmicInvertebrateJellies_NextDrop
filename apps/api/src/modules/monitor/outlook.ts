import type { ApiDto } from "@nextdrop/contracts";
import { addDays, isoWeekOf, type LocalDate } from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";

/** Delivery days in a week and trips per vehicle per day used for the weekly fleet capacity. */
export const OUTLOOK_DELIVERY_DAYS = 6;
export const OUTLOOK_TRIPS_PER_DAY = 1;
const BRANDS = ["Fresh", "Style", "Tech"] as const;
const AVERAGE_OF = 4;

const litres = (m3: number) => Math.round(m3 * 1000);

/**
 * `GET /dispatch/outlook` (D5): weekly demand against the depot's fleet capacity. A week with seeded
 * `WeeklyDemandHistory` reports it; a later week is the moving average of the last four weeks before it.
 * Capacity is the depot's vehicle volume times delivery days and trips per day.
 */
export async function listOutlook(
  prisma: PrismaClient,
  depot: string,
  from: LocalDate,
  weeks: number,
): Promise<ApiDto<"outlookResponse">["items"]> {
  const [history, vehicles] = await Promise.all([
    prisma.weeklyDemandHistory.findMany({ where: { depot }, orderBy: [{ isoYear: "asc" }, { isoWeek: "asc" }] }),
    prisma.vehicle.findMany({ where: { depot }, select: { volumeCapM3: true } }),
  ]);
  const dailyM3 = vehicles.reduce((sum, v) => sum + Number(v.volumeCapM3), 0);
  const capacityVolumeL = litres(dailyM3 * OUTLOOK_DELIVERY_DAYS * OUTLOOK_TRIPS_PER_DAY);
  const key = (year: number, week: number) => year * 100 + week;
  const items: ApiDto<"outlookResponse">["items"] = [];
  for (const brand of BRANDS) {
    const known = new Map<number, { total: number; chilled: number }>();
    for (const row of history)
      if (row.brand === brand)
        known.set(key(row.isoYear, row.isoWeek), {
          total: Number(row.totalVolumeM3),
          chilled: Number(row.chilledVolumeM3),
        });
    for (let i = 0; i < weeks; i++) {
      const { isoYear, isoWeek } = isoWeekOf(addDays(from, i * 7));
      const k = key(isoYear, isoWeek);
      let week = known.get(k);
      if (!week) {
        const earlier = [...known.entries()].filter(([at]) => at < k).slice(-AVERAGE_OF);
        if (!earlier.length) continue;
        week = {
          total: earlier.reduce((sum, [, v]) => sum + v.total, 0) / earlier.length,
          chilled: earlier.reduce((sum, [, v]) => sum + v.chilled, 0) / earlier.length,
        };
        known.set(k, week);
      }
      items.push({
        isoYear,
        isoWeek,
        brand,
        demandVolumeL: litres(week.total),
        chilledVolumeL: litres(week.chilled),
        capacityVolumeL,
      });
    }
  }
  return items.sort((a, b) => key(a.isoYear, a.isoWeek) - key(b.isoYear, b.isoWeek) || a.brand.localeCompare(b.brand));
}
