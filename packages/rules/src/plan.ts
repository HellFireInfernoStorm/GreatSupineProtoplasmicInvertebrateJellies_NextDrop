// Plan inputs as the rules core sees them: orders with integer sizes, and trips that carry their orders.
import type { LocalDate } from "./calendar";
import type { OrderStatus } from "./order-reducer";
import type { Brand, Outlet, ReferenceData, TempRequirement } from "./reference";
import type { Grams, Litres } from "./units";

export interface PlanOrder {
  readonly id: string;
  readonly outletId: string;
  readonly temp: TempRequirement;
  readonly weightG: Grams;
  readonly volumeL: Litres;
  /** The delivery date the order is confirmed for. */
  readonly deliveryDate: LocalDate;
  /** Current status from the order reducer, when known. Used for ORDER_NOT_CONFIRMED and ORDER_ALREADY_LOADED. */
  readonly status?: OrderStatus;
}

export interface PlanTrip {
  /** Display id, e.g. `T015`. Unique within a plan. */
  readonly ref: string;
  readonly vehicleId: string;
  /** 1 or 2. */
  readonly tripNo: number;
  readonly orders: readonly PlanOrder[];
}

/** Fresh trips share the 270-minute budget; Style and Tech trips share the 480-minute budget. */
export type BudgetClass = "FRESH" | "STYLE_TECH";

export function budgetClassOf(brand: Brand): BudgetClass {
  return brand === "Fresh" ? "FRESH" : "STYLE_TECH";
}

export function outletOf(order: PlanOrder, ref: Pick<ReferenceData, "outlets">): Outlet {
  const outlet = ref.outlets.get(order.outletId);
  if (!outlet) throw new RangeError(`order ${order.id}: unknown outlet ${order.outletId}`);
  return outlet;
}

/** The trip's brand and district: those of its first order (the validator checks that all orders agree). */
export function tripBrandAndDistrict(
  trip: PlanTrip,
  ref: Pick<ReferenceData, "outlets">,
): { brand: Brand; district: string } | null {
  const first = trip.orders[0];
  if (!first) return null;
  const outlet = outletOf(first, ref);
  return { brand: outlet.brand, district: outlet.district };
}
