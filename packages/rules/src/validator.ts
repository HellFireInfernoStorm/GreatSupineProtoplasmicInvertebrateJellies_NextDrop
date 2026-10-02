// The validator: the one implementation of every hard constraint and warning (spec/rules-core/validator-codes.md,
// spec/domain/constraints.md). The server, the browser and the allocator all call it.
import type { LocalDate } from "./calendar";
import { isOperatingDay } from "./calendar";
import type { RulesConfig } from "./config";
import { DEFAULT_RULES_CONFIG } from "./config";
import type { TripSchedule } from "./etas";
import { computeRunSchedule } from "./etas";
import { computeFuel } from "./fuel";
import type { OrderStatus } from "./order-reducer";
import type { BudgetClass, PlanOrder, PlanTrip } from "./plan";
import type { Outlet, ReferenceData, Vehicle } from "./reference";
import type { Millilitres } from "./units";

export const HARD_CODES = [
  "WEIGHT_CAP_EXCEEDED",
  "VOLUME_CAP_EXCEEDED",
  "REEFER_REQUIRED",
  "VAN_REQUIRED",
  "DEPOT_MISMATCH",
  "MIXED_BRAND",
  "MIXED_DISTRICT",
  "ORDER_SPLIT",
  "ORDER_UNASSIGNED_UNKNOWN",
  "TRIP_LIMIT_EXCEEDED",
  "TIME_BUDGET_EXCEEDED",
  "WINDOW_MISSED",
  "MALL_WINDOW_VIOLATION",
  "NON_OPERATING_DAY",
  "FUEL_QUOTA_EXCEEDED",
  "VEHICLE_UNAVAILABLE",
  "ORDER_NOT_CONFIRMED",
  "ORDER_ALREADY_LOADED",
] as const;
export const WARN_CODES = ["LATE_RISK", "REPEAT_DEFERRAL", "LOW_FUEL_MARGIN"] as const;
export type HardCode = (typeof HARD_CODES)[number];
export type WarnCode = (typeof WARN_CODES)[number];
export type ViolationCode = HardCode | WarnCode;
export type Severity = "HARD" | "WARN";

export interface Violation {
  readonly code: ViolationCode;
  readonly severity: Severity;
  readonly tripRef?: string;
  readonly vehicleId?: string;
  readonly orderIds: readonly string[];
  /** `limit` and `actual` in the rules core's units (grams, litres, minutes, millilitres), plus code-specific detail. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
  /** i18n key: `validator.<CODE>`. */
  readonly message_key: string;
}

export interface ValidationResult {
  /** True when there is no HARD violation. Warnings never block. */
  readonly ok: boolean;
  readonly violations: readonly Violation[];
}

/** A LOADED order as the current published plan holds it (ADR 0004). */
export interface LoadedPin {
  readonly vehicleId: string;
  readonly tripNo: number;
  readonly reversalRequested: boolean;
}

export interface PlanDeferral {
  readonly orderId: string;
  readonly reasonCode?: string;
  readonly note?: string;
}

export interface Plan {
  readonly date: LocalDate;
  readonly trips: readonly PlanTrip[];
  /** The day's confirmed orders. When given, a trip holding any other order is `ORDER_UNASSIGNED_UNKNOWN`. */
  readonly orders?: readonly PlanOrder[];
  readonly deferrals?: readonly PlanDeferral[];
}

export interface ValidationContext {
  readonly cfg?: RulesConfig;
  /** Vehicles `IN_WORKSHOP` on the plan's date, whatever the reason (ADR 0017). */
  readonly unavailableVehicleIds?: ReadonlySet<string>;
  /** Fuel each vehicle already used this ISO week, excluding this day's published trips (ADR 0006). */
  readonly fuelUsedThisWeekMl?: ReadonlyMap<string, Millilitres>;
  /** Outlets deferred on the previous run, for `REPEAT_DEFERRAL`. */
  readonly deferredLastRunOutletIds?: ReadonlySet<string>;
  /** LOADED orders by id, with where the published plan has them. */
  readonly loadedOrders?: ReadonlyMap<string, LoadedPin>;
}

/** Statuses an order can be planned from. LOADED stays on its own trip (ADR 0004). */
const PLANNABLE: ReadonlySet<OrderStatus> = new Set(["ORDERED", "PLANNED", "DEFERRED", "FAILED", "LOADED"]);

class Collector {
  readonly violations: Violation[] = [];

  add(
    code: ViolationCode,
    where: { tripRef?: string; vehicleId?: string },
    orderIds: readonly string[],
    params: Record<string, string | number | boolean> = {},
  ): void {
    const severity: Severity = (WARN_CODES as readonly string[]).includes(code) ? "WARN" : "HARD";
    this.violations.push({
      code,
      severity,
      ...(where.tripRef === undefined ? {} : { tripRef: where.tripRef }),
      ...(where.vehicleId === undefined ? {} : { vehicleId: where.vehicleId }),
      orderIds,
      params,
      message_key: `validator.${code}`,
    });
  }

  result(): ValidationResult {
    return { ok: !this.violations.some((v) => v.severity === "HARD"), violations: this.violations };
  }
}

/** Authoritative check of a whole plan. */
export function validatePlan(plan: Plan, ref: ReferenceData, ctx: ValidationContext = {}): ValidationResult {
  const cfg = ctx.cfg ?? DEFAULT_RULES_CONFIG;
  const out = new Collector();

  if (!isOperatingDay(plan.date, ref.calendar)) out.add("NON_OPERATING_DAY", {}, [], { date: plan.date });

  // Whole orders: one order on exactly one trip.
  const placements = new Map<string, string[]>();
  for (const trip of plan.trips) {
    for (const o of trip.orders) placements.set(o.id, [...(placements.get(o.id) ?? []), trip.ref]);
  }
  for (const [orderId, refs] of placements) {
    if (refs.length > 1) out.add("ORDER_SPLIT", {}, [orderId], { trips: refs.join(",") });
  }

  const known = plan.orders ? new Set(plan.orders.map((o) => o.id)) : null;
  const byVehicle = new Map<string, PlanTrip[]>();
  for (const trip of plan.trips) byVehicle.set(trip.vehicleId, [...(byVehicle.get(trip.vehicleId) ?? []), trip]);

  for (const [vehicleId, trips] of byVehicle) {
    const vehicle = ref.vehicles.get(vehicleId);
    if (!vehicle) {
      for (const t of trips)
        out.add("VEHICLE_UNAVAILABLE", { tripRef: t.ref, vehicleId }, ids(t), { reason: "UNKNOWN_VEHICLE" });
      continue;
    }
    if (ctx.unavailableVehicleIds?.has(vehicleId)) {
      for (const t of trips)
        out.add("VEHICLE_UNAVAILABLE", { tripRef: t.ref, vehicleId }, ids(t), {
          reason: "IN_WORKSHOP",
          date: plan.date,
        });
    }
    checkTripCount(out, vehicleId, trips, cfg);
    const usable = trips.map((t) => checkTripOrders(out, t, vehicle, plan.date, ref, known));
    checkRun(out, vehicle, usable, plan.date, ref, ctx, cfg);
  }

  checkLoadedPins(out, plan, ctx);
  checkRepeatDeferrals(out, plan, ref, ctx);
  return out.result();
}

/** Live check for one trip: the trip and its vehicle's day. `siblingTrips` are the vehicle's other trips. */
export function validateTrip(
  trip: PlanTrip,
  ref: ReferenceData,
  ctx: ValidationContext & { readonly date: LocalDate; readonly siblingTrips?: readonly PlanTrip[] },
): ValidationResult {
  const siblings = (ctx.siblingTrips ?? []).filter((t) => t.vehicleId === trip.vehicleId && t.ref !== trip.ref);
  const { violations } = validatePlan({ date: ctx.date, trips: [trip, ...siblings] }, ref, ctx);
  const mine = violations.filter(
    (v) =>
      v.tripRef === trip.ref ||
      (v.tripRef === undefined && v.vehicleId === trip.vehicleId) ||
      v.code === "NON_OPERATING_DAY",
  );
  return { ok: !mine.some((v) => v.severity === "HARD"), violations: mine };
}

function ids(trip: PlanTrip): string[] {
  return trip.orders.map((o) => o.id);
}

function checkTripCount(out: Collector, vehicleId: string, trips: readonly PlanTrip[], cfg: RulesConfig): void {
  const numbers = trips.map((t) => t.tripNo);
  const badNumber = numbers.some((n) => !Number.isInteger(n) || n < 1 || n > cfg.maxTripsPerVehicle);
  const duplicate = new Set(numbers).size !== numbers.length;
  if (trips.length > cfg.maxTripsPerVehicle || badNumber || duplicate) {
    out.add("TRIP_LIMIT_EXCEEDED", { vehicleId }, trips.flatMap(ids), {
      limit: cfg.maxTripsPerVehicle,
      actual: trips.length,
      tripNos: numbers.join(","),
    });
  }
}

/**
 * Order-level and capacity checks for one trip. Returns the trip restricted to orders whose outlet is known, which is
 * what timing and fuel can be computed on.
 */
function checkTripOrders(
  out: Collector,
  trip: PlanTrip,
  vehicle: Vehicle,
  date: LocalDate,
  ref: ReferenceData,
  known: ReadonlySet<string> | null,
): PlanTrip {
  const where = { tripRef: trip.ref, vehicleId: vehicle.id };
  const located: { order: PlanOrder; outlet: Outlet }[] = [];
  for (const order of trip.orders) {
    const outlet = ref.outlets.get(order.outletId);
    if ((known && !known.has(order.id)) || !outlet) {
      out.add("ORDER_UNASSIGNED_UNKNOWN", where, [order.id], { reason: outlet ? "UNKNOWN_ORDER" : "UNKNOWN_OUTLET" });
      if (!outlet) continue;
    }
    located.push({ order, outlet });
    if (order.deliveryDate !== date || (order.status !== undefined && !PLANNABLE.has(order.status))) {
      out.add("ORDER_NOT_CONFIRMED", where, [order.id], {
        deliveryDate: order.deliveryDate,
        planDate: date,
        status: order.status ?? "",
      });
    }
    if (order.temp === "chilled" && vehicle.temp !== "reefer") out.add("REEFER_REQUIRED", where, [order.id]);
    if (outlet.parking === "van_only" && vehicle.type !== "van") out.add("VAN_REQUIRED", where, [order.id]);
    if (outlet.depot !== vehicle.depot) {
      out.add("DEPOT_MISMATCH", where, [order.id], { vehicleDepot: vehicle.depot, outletDepot: outlet.depot });
    }
  }

  const head = located[0];
  if (head) {
    const otherBrand = located.filter((l) => l.outlet.brand !== head.outlet.brand).map((l) => l.order.id);
    if (otherBrand.length) out.add("MIXED_BRAND", where, otherBrand, { tripBrand: head.outlet.brand });
    const otherDistrict = located.filter((l) => l.outlet.district !== head.outlet.district).map((l) => l.order.id);
    if (otherDistrict.length) out.add("MIXED_DISTRICT", where, otherDistrict, { tripDistrict: head.outlet.district });
  }

  const weight = trip.orders.reduce((s, o) => s + o.weightG, 0);
  const volume = trip.orders.reduce((s, o) => s + o.volumeL, 0);
  if (weight > vehicle.weightCapG)
    out.add("WEIGHT_CAP_EXCEEDED", where, ids(trip), { limit: vehicle.weightCapG, actual: weight });
  if (volume > vehicle.volumeCapL)
    out.add("VOLUME_CAP_EXCEEDED", where, ids(trip), { limit: vehicle.volumeCapL, actual: volume });

  return located.length === trip.orders.length ? trip : { ...trip, orders: located.map((l) => l.order) };
}

/** Time budgets, windows and weekly fuel for one vehicle's day. */
function checkRun(
  out: Collector,
  vehicle: Vehicle,
  trips: readonly PlanTrip[],
  date: LocalDate,
  ref: ReferenceData,
  ctx: ValidationContext,
  cfg: RulesConfig,
): void {
  const timed = trips.filter((t) => t.orders.length > 0 && ref.districts.has(districtOfFirst(t, ref)));
  const run: TripSchedule[] = computeRunSchedule(timed, ref, cfg);

  const budgets: Record<BudgetClass, number> = { FRESH: cfg.freshBudgetMin, STYLE_TECH: cfg.styleTechBudgetMin };
  for (const cls of ["FRESH", "STYLE_TECH"] as const) {
    const inClass = run.filter((s) => s.time.budgetClass === cls);
    const used = inClass.reduce((s, t) => s + t.time.totalMin, 0);
    if (used > budgets[cls]) {
      out.add(
        "TIME_BUDGET_EXCEEDED",
        { vehicleId: vehicle.id },
        inClass.flatMap((s) => ids(s.trip)),
        {
          limit: budgets[cls],
          actual: used,
          budgetClass: cls,
        },
      );
    }
  }

  for (const s of run) {
    const where = { tripRef: s.trip.ref, vehicleId: vehicle.id };
    for (const stop of s.stops) {
      const outlet = ref.outlets.get(stop.outletId);
      const mall = outlet?.mallWindow ?? null;
      if (!stop.onTimeValidation) {
        const actual = stop.validation.start;
        if (mall && (stop.window === null || actual > mall.close)) {
          out.add("MALL_WINDOW_VIOLATION", where, [stop.orderId], { limit: mall.close, actual, open: mall.open });
        } else {
          out.add("WINDOW_MISSED", where, [stop.orderId], {
            limit: stop.window?.close ?? 0,
            actual,
            open: stop.window?.open ?? 0,
          });
        }
      } else if (!stop.onTimeDisplay) {
        out.add("LATE_RISK", where, [stop.orderId], { limit: stop.window?.close ?? 0, actual: stop.display.start });
      }
    }
  }

  const planned = timed.reduce((s, t) => s + computeFuel(t, vehicle, ref, cfg).millilitres, 0);
  const used = (ctx.fuelUsedThisWeekMl?.get(vehicle.id) ?? 0) + planned;
  const quota = vehicle.weeklyFuelQuotaMl;
  if (used > quota) {
    out.add("FUEL_QUOTA_EXCEEDED", { vehicleId: vehicle.id }, timed.flatMap(ids), { limit: quota, actual: used, date });
  } else if (planned > 0 && (quota - used) * 100 < quota * cfg.lowFuelMarginPct) {
    out.add("LOW_FUEL_MARGIN", { vehicleId: vehicle.id }, timed.flatMap(ids), { limit: quota, actual: used, date });
  }
}

function districtOfFirst(trip: PlanTrip, ref: ReferenceData): string {
  const first = trip.orders[0];
  return (first && ref.outlets.get(first.outletId)?.district) ?? "";
}

/** ADR 0004: a LOADED order stays on its published vehicle and trip unless a reversal was requested. */
function checkLoadedPins(out: Collector, plan: Plan, ctx: ValidationContext): void {
  if (!ctx.loadedOrders?.size) return;
  const where = new Map<string, PlanTrip>();
  for (const trip of plan.trips) for (const o of trip.orders) where.set(o.id, trip);
  for (const [orderId, pin] of ctx.loadedOrders) {
    if (pin.reversalRequested) continue;
    const trip = where.get(orderId);
    if (!trip || trip.vehicleId !== pin.vehicleId || trip.tripNo !== pin.tripNo) {
      out.add(
        "ORDER_ALREADY_LOADED",
        trip ? { tripRef: trip.ref, vehicleId: trip.vehicleId } : { vehicleId: pin.vehicleId },
        [orderId],
        {
          loadedOnVehicle: pin.vehicleId,
          loadedOnTrip: pin.tripNo,
          change: trip ? "MOVED" : "REMOVED",
        },
      );
    }
  }
}

function checkRepeatDeferrals(out: Collector, plan: Plan, ref: ReferenceData, ctx: ValidationContext): void {
  if (!plan.deferrals?.length || !ctx.deferredLastRunOutletIds?.size) return;
  const orders = new Map((plan.orders ?? []).map((o) => [o.id, o]));
  for (const d of plan.deferrals) {
    const outletId = orders.get(d.orderId)?.outletId;
    if (outletId && ref.outlets.has(outletId) && ctx.deferredLastRunOutletIds.has(outletId)) {
      out.add("REPEAT_DEFERRAL", {}, [d.orderId], { outletId, noteProvided: Boolean(d.note?.trim()) });
    }
  }
}
