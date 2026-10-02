// Fuel per trip (spec/domain/trip-time-and-budgets.md §4.5), in integer metres and millilitres (ADR 0018).
import type { RulesConfig } from "./config";
import { DEFAULT_RULES_CONFIG } from "./config";
import type { PlanTrip } from "./plan";
import { tripBrandAndDistrict } from "./plan";
import type { ReferenceData, Vehicle } from "./reference";
import { districtOf } from "./trip-time";
import type { Metres, Millilitres } from "./units";

export interface FuelUse {
  readonly metres: Metres;
  /** Rounded up to a whole millilitre, so the quota check is never optimistic. */
  readonly millilitres: Millilitres;
  /** For display only. */
  readonly km: number;
  /** For display only. */
  readonly litres: number;
}

/** `km = depot_to_district_km × (return ? 2 : 1) + inter_stop_km × (n − 1)`; `litres = km / km_per_l`. */
export function computeFuel(
  trip: PlanTrip,
  vehicle: Vehicle,
  ref: ReferenceData,
  cfg: Pick<RulesConfig, "fuelIncludeReturn"> = DEFAULT_RULES_CONFIG,
): FuelUse {
  const head = tripBrandAndDistrict(trip, ref);
  if (!head) return { metres: 0, millilitres: 0, km: 0, litres: 0 };
  const district = districtOf(head.district, ref);
  const metres =
    district.depotToDistrictM * (cfg.fuelIncludeReturn ? 2 : 1) + district.interStopM * (trip.orders.length - 1);
  const millilitres = Math.ceil((metres * 1000) / vehicle.metresPerLitre);
  return { metres, millilitres, km: metres / 1000, litres: millilitres / 1000 };
}
