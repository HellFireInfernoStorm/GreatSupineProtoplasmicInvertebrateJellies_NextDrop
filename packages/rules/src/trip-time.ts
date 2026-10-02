// Trip time exactly as the Booklet defines it (spec/domain/trip-time-and-budgets.md §4.3). No return leg.
// Free-flow minutes only: traffic and road conditions are not inputs, so they can never affect validity.
import type { BudgetClass, PlanTrip } from "./plan";
import { budgetClassOf, outletOf, tripBrandAndDistrict } from "./plan";
import type { Brand, DistrictTravel, DockType, ReferenceData } from "./reference";
import { serviceAllowanceKey } from "./reference";
import type { Minutes } from "./units";

export interface TripTimeBreakdown {
  readonly brand: Brand | null;
  readonly district: string | null;
  readonly budgetClass: BudgetClass | null;
  /** `depot_to_district_freeflow_min`, once per trip. */
  readonly outboundMin: Minutes;
  /** `inter_stop_freeflow_min × (n − 1)`. */
  readonly interStopMin: Minutes;
  /** Sum of `service_allowance_min[trip brand, outlet dock_type]`. */
  readonly handlingMin: Minutes;
  readonly totalMin: Minutes;
  /** Handling minutes per order id. */
  readonly handlingByOrder: Readonly<Record<string, Minutes>>;
}

const EMPTY: TripTimeBreakdown = {
  brand: null,
  district: null,
  budgetClass: null,
  outboundMin: 0,
  interStopMin: 0,
  handlingMin: 0,
  totalMin: 0,
  handlingByOrder: {},
};

export function districtOf(name: string, ref: Pick<ReferenceData, "districts">): DistrictTravel {
  const d = ref.districts.get(name);
  if (!d) throw new RangeError(`unknown district ${name}`);
  return d;
}

export function serviceAllowanceMin(
  brand: Brand,
  dockType: DockType,
  ref: Pick<ReferenceData, "serviceAllowances">,
): Minutes {
  const s = ref.serviceAllowances.get(serviceAllowanceKey(brand, dockType));
  if (!s) throw new RangeError(`no service allowance for ${brand} at ${dockType}`);
  return s.minutes;
}

/** `trip_minutes = outbound + inter-stop × (n − 1) + Σ handling`, using the trip's brand and district. */
export function computeTripTime(trip: PlanTrip, ref: ReferenceData): TripTimeBreakdown {
  const head = tripBrandAndDistrict(trip, ref);
  if (!head) return EMPTY;
  const district = districtOf(head.district, ref);
  const handlingByOrder: Record<string, Minutes> = {};
  let handlingMin = 0;
  for (const order of trip.orders) {
    const minutes = serviceAllowanceMin(head.brand, outletOf(order, ref).dockType, ref);
    handlingByOrder[order.id] = minutes;
    handlingMin += minutes;
  }
  const outboundMin = district.depotToDistrictMin;
  const interStopMin = district.interStopMin * (trip.orders.length - 1);
  return {
    brand: head.brand,
    district: head.district,
    budgetClass: budgetClassOf(head.brand),
    outboundMin,
    interStopMin,
    handlingMin,
    totalMin: outboundMin + interStopMin + handlingMin,
    handlingByOrder,
  };
}
