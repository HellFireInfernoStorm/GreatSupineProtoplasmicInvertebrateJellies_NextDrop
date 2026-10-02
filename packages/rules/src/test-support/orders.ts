// Test-only order and trip builders.
import type { PlanOrder, PlanTrip } from "../plan";
import type { TempRequirement } from "../reference";

export function order(
  id: string,
  outletId: string,
  opts: Partial<PlanOrder> & { temp?: TempRequirement } = {},
): PlanOrder {
  return {
    id,
    outletId,
    temp: "ambient",
    weightG: 100_000,
    volumeL: 500,
    deliveryDate: "2026-10-06",
    status: "ORDERED",
    ...opts,
  };
}

export function trip(ref: string, vehicleId: string, tripNo: number, orders: readonly PlanOrder[]): PlanTrip {
  return { ref, vehicleId, tripNo, orders };
}
