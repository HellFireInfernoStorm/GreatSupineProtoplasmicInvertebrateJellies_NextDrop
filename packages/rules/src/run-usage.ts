import { DEFAULT_RULES_CONFIG } from "./config";
import { computeRunSchedule } from "./etas";
import { computeFuel } from "./fuel";
import type { BudgetClass, PlanTrip } from "./plan";
import type { ReferenceData, Vehicle } from "./reference";
import type { ValidationContext } from "./validator";

export type RunUsage = ReturnType<typeof runUsage>;

/** The exact time/fuel inputs compared by the validator for one vehicle's day.
 * Unknown outlets are excluded just as in order validation; only a known first district can be timed.
 * Invalid trips still receive their separate order/reference violations from the validator.
 */
export function runUsage(
  trips: readonly PlanTrip[],
  vehicle: Vehicle,
  ref: ReferenceData,
  ctx: Pick<ValidationContext, "cfg" | "fuelUsedThisWeekMl"> = {},
) {
  const cfg = ctx.cfg ?? DEFAULT_RULES_CONFIG;
  const timedTrips = trips
    .filter((trip) => trip.vehicleId === vehicle.id)
    .map((trip) => ({ ...trip, orders: trip.orders.filter((order) => ref.outlets.has(order.outletId)) }))
    .filter((trip) => trip.orders.length > 0 && ref.districts.has(ref.outlets.get(trip.orders[0]!.outletId)!.district));
  const schedules = computeRunSchedule(timedTrips, ref, cfg);
  const minutesByClass: Record<BudgetClass, number> = { FRESH: 0, STYLE_TECH: 0 };
  for (const schedule of schedules) {
    if (schedule.time.budgetClass) minutesByClass[schedule.time.budgetClass] += schedule.time.totalMin;
  }
  const budgetByClass: Record<BudgetClass, number> = {
    FRESH: cfg.freshBudgetMin,
    STYLE_TECH: cfg.styleTechBudgetMin,
  };
  const fuelEntries = timedTrips.map((trip) => [trip.ref, computeFuel(trip, vehicle, ref, cfg).millilitres] as const);
  const fuelByTripMl = new Map(fuelEntries);
  const plannedFuelMl = fuelEntries.reduce((sum, [, fuel]) => sum + fuel, 0);
  return {
    timedTrips,
    schedules,
    minutesByClass,
    budgetByClass,
    fuelByTripMl,
    plannedFuelMl,
    weekFuelMl: (ctx.fuelUsedThisWeekMl?.get(vehicle.id) ?? 0) + plannedFuelMl,
    fuelQuotaMl: vehicle.weeklyFuelQuotaMl,
  };
}
