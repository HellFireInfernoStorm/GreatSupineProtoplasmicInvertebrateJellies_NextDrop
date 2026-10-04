import type { ApiDto } from "@nextdrop/contracts";
import {
  addDays,
  type Calendar,
  dayOfWeek,
  DEFAULT_RULES_CONFIG,
  isOperatingDay,
  isoWeekOf,
  type LocalDate,
  m3ToLitres,
} from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { dateOnly } from "../orders";

const BRANDS = ["Fresh", "Style", "Tech"] as const;
const AVERAGE_OF = 4;
/** Monday to Saturday: `dayOfWeek` 0..5 (the Booklet: "Waypoint operates Monday through Saturday"). */
const WORKING_DAYS = 6;
/** Absorbs float noise in the fuel cap, so an exact quota of N trips is not floored to N - 1. */
const EPSILON = 1e-9;

const litres = (m3: number) => Math.round(m3 * 1000);

interface FleetVehicle {
  volumeL: number;
  reefer: boolean;
  /** Trips the weekly fuel quota covers at the depot's typical round trip; Infinity when the depot has no districts. */
  fuelTrips: number;
}

/** Operating Mon–Sat days of the ISO week holding `date`. A date the calendar lacks is operating Mon–Sat. */
function operatingDays(date: LocalDate, calendar: Calendar): number {
  const monday = addDays(date, -dayOfWeek(date));
  let days = 0;
  for (let d = 0; d < WORKING_DAYS; d++) if (isOperatingDay(addDays(monday, d), calendar)) days++;
  return days;
}

/**
 * The depot's usable fleet (ADR 0055): its vehicles, less those `IN_WORKSHOP` on `date`, each with the trips its
 * weekly fuel quota covers: floor(weeklyFuelQuotaL × kmPerL / typicalTripKm), where typicalTripKm is the mean round
 * trip (2 × depotToDistrictKm) over the depot's districts.
 */
async function usableFleet(prisma: PrismaClient, depot: string, date: LocalDate): Promise<FleetVehicle[]> {
  const [vehicles, districts] = await Promise.all([
    prisma.vehicle.findMany({
      where: { depot, vehicleAvailability_vehicleId: { none: { date: dateOnly(date), status: "IN_WORKSHOP" } } },
      select: { volumeCapM3: true, temp: true, kmPerL: true, weeklyFuelQuotaL: true },
    }),
    prisma.district.findMany({ where: { depot }, select: { depotToDistrictKm: true } }),
  ]);
  const typicalTripKm = districts.length
    ? districts.reduce((sum, d) => sum + 2 * d.depotToDistrictKm.toNumber(), 0) / districts.length
    : 0;
  return vehicles.map((v) => ({
    volumeL: m3ToLitres(v.volumeCapM3.toNumber()),
    reefer: v.temp === "reefer",
    fuelTrips:
      typicalTripKm > 0
        ? Math.floor((v.weeklyFuelQuotaL.toNumber() * v.kmPerL.toNumber()) / typicalTripKm + EPSILON)
        : Number.POSITIVE_INFINITY,
  }));
}

/** Weekly volume of `fleet`: each vehicle's volume times max trips per operating day, capped by its fuel trips. */
function weeklyCapacityL(fleet: FleetVehicle[], days: number): number {
  const maxTrips = DEFAULT_RULES_CONFIG.maxTripsPerVehicle * days;
  return Math.round(fleet.reduce((sum, v) => sum + v.volumeL * Math.min(maxTrips, v.fuelTrips), 0));
}

/**
 * `GET /dispatch/outlook` (D5, ADR 0055): weekly demand against the depot's usable fleet capacity. A week with seeded
 * `WeeklyDemandHistory` reports it; a later week is the moving average of the last four weeks before it.
 * Capacity is per week: the usable fleet (vehicles not `IN_WORKSHOP` on `from`) at `maxTripsPerVehicle` trips on each
 * of the week's operating Mon–Sat days, each vehicle capped by its weekly fuel quota. Reefer capacity is the same over
 * reefer vehicles, the limit for chilled demand.
 */
export async function listOutlook(
  prisma: PrismaClient,
  calendar: Calendar,
  depot: string,
  from: LocalDate,
  weeks: number,
): Promise<ApiDto<"outlookResponse">["items"]> {
  const [history, fleet] = await Promise.all([
    prisma.weeklyDemandHistory.findMany({ where: { depot }, orderBy: [{ isoYear: "asc" }, { isoWeek: "asc" }] }),
    usableFleet(prisma, depot, from),
  ]);
  const reefers = fleet.filter((v) => v.reefer);
  const key = (year: number, week: number) => year * 100 + week;
  const capacity = new Map<number, { capacityVolumeL: number; reeferCapacityVolumeL: number }>();
  for (let i = 0; i < weeks; i++) {
    const date = addDays(from, i * 7);
    const { isoYear, isoWeek } = isoWeekOf(date);
    const days = operatingDays(date, calendar);
    capacity.set(key(isoYear, isoWeek), {
      capacityVolumeL: weeklyCapacityL(fleet, days),
      reeferCapacityVolumeL: weeklyCapacityL(reefers, days),
    });
  }
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
        ...capacity.get(k)!,
      });
    }
  }
  return items.sort((a, b) => key(a.isoYear, a.isoWeek) - key(b.isoYear, b.isoWeek) || a.brand.localeCompare(b.brand));
}
