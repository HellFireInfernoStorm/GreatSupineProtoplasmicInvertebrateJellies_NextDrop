import type { ApiDto } from "@nextdrop/contracts";
import {
  buildReferenceData,
  districtTravelFromRow,
  serviceAllowanceFromRow,
  validatePlan,
  lockedStopChange,
  validateTrip,
  type Plan,
  type ValidationContext,
} from "@nextdrop/rules";
import districtCsv from "../../../../../data/reference/district_travel.csv?raw";
import allowanceCsv from "../../../../../data/reference/service_allowance.csv?raw";

export type DraftData = ApiDto<"draftData">;
export type Draft = ApiDto<"draft">;
export type Order = ApiDto<"order">;
export type Vehicle = ApiDto<"vehicle">;
export type Outlet = ApiDto<"outlet">;

// These two approved reference CSVs contain no quoted fields. Refuse unsupported formats rather than corrupt data.
function rows(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines.shift()!.split(",");
  return lines.map((line) => {
    if (line.includes('"')) throw new Error("Quoted planning reference field");
    const values = line.split(",");
    if (values.length !== headers.length) throw new Error("Invalid planning reference row");
    return Object.fromEntries(headers.map((header, i) => [header, values[i]!]));
  });
}

export function makeReference(
  outlets: readonly Outlet[],
  vehicles: readonly Vehicle[],
  calendar: readonly ApiDto<"calendarDay">[],
) {
  return {
    ref: buildReferenceData({
      outlets: outlets.map((o) => ({ ...o, id: o.displayId })),
      vehicles: vehicles.map((v) => ({ ...v, id: v.displayId })),
      districts: rows(districtCsv).map(districtTravelFromRow),
      serviceAllowances: rows(allowanceCsv).map(serviceAllowanceFromRow),
      calendar,
    }),
    outletDisplay: new Map(outlets.map((o) => [o.id, o.displayId])),
    vehicleDisplay: new Map(vehicles.map((v) => [v.id, v.displayId])),
  };
}
export type BrowserReference = ReturnType<typeof makeReference>;

export function emptyDraft(orderIds: readonly string[]): DraftData {
  return { trips: [], unassignedOrderIds: [...orderIds], deferrals: [] };
}

export function moveOrder(data: DraftData, orderId: string, destination: string | null): DraftData {
  if (!data.unassignedOrderIds.includes(orderId) && !data.trips.some((t) => t.orderIds.includes(orderId)))
    throw new Error("Unknown order");
  if (destination !== null && !data.trips.some((t) => t.ref === destination)) throw new Error("Unknown trip");
  return {
    trips: data.trips.map((t) => ({
      ...t,
      orderIds:
        t.ref === destination
          ? [...t.orderIds.filter((id) => id !== orderId), orderId]
          : t.orderIds.filter((id) => id !== orderId),
    })),
    unassignedOrderIds:
      destination === null
        ? [...data.unassignedOrderIds.filter((id) => id !== orderId), orderId]
        : data.unassignedOrderIds.filter((id) => id !== orderId),
    deferrals: destination === null ? [...data.deferrals] : data.deferrals.filter((d) => d.orderId !== orderId),
  };
}

export function addTrip(data: DraftData, trip: ApiDto<"draftTrip">): DraftData {
  if (data.trips.some((t) => t.ref === trip.ref || (t.vehicleId === trip.vehicleId && t.tripNo === trip.tripNo)))
    throw new Error("Occupied trip slot");
  let candidate: DraftData = { ...data, trips: [...data.trips, { ...trip, orderIds: [] }] };
  for (const orderId of trip.orderIds) candidate = moveOrder(candidate, orderId, trip.ref);
  return candidate;
}

export function toPlan(data: DraftData, orders: readonly Order[], date: string, reference: BrowserReference): Plan {
  const mapped = orders.map((o) => ({
    id: o.id,
    outletId: reference.outletDisplay.get(o.outletId) ?? o.outletId,
    temp: o.tempRequirement,
    weightG: o.weightG,
    volumeL: o.volumeL,
    deliveryDate: o.currentDate,
    status: o.status,
  }));
  const byId = new Map(mapped.map((o) => [o.id, o]));
  return {
    date,
    orders: mapped,
    deferrals: data.deferrals,
    trips: data.trips.map((t) => ({
      preserveOrder: true,
      ...t,
      vehicleId: reference.vehicleDisplay.get(t.vehicleId) ?? t.vehicleId,
      orders: t.orderIds.map(
        (id) =>
          byId.get(id) ?? { id, outletId: "", temp: "ambient" as const, weightG: 0, volumeL: 0, deliveryDate: date },
      ),
    })),
  };
}

export function evaluate(
  data: DraftData,
  orders: readonly Order[],
  date: string,
  reference: BrowserReference,
  unavailableVehicleIds: ReadonlySet<string>,
  context: ValidationContext = {},
) {
  const plan = toPlan(data, orders, date, reference);
  const ctx = { ...context, unavailableVehicleIds };
  const whole = validatePlan(plan, reference.ref, ctx);
  // Trip checks receive their siblings so second-trip budgets, windows and fuel are evaluated together.
  const trips = new Map(
    plan.trips.map((trip) => [trip.ref, validateTrip(trip, reference.ref, { ...ctx, date, siblingTrips: plan.trips })]),
  );
  const lockedOrderId = lockedDraftChange(data, reference, context);
  return { ...whole, ok: whole.ok && lockedOrderId === null, lockedOrderId, trips, plan };
}

/** The demand vs capacity tiles on D0 and D1: queue weight in t against the fleet, chilled volume in m³ against reefers. */
export function demandVsCapacity(queue: readonly Order[], available: readonly Vehicle[]) {
  const reefers = available.filter((v) => v.temp === "reefer");
  return {
    weightT: queue.reduce((n, o) => n + o.weightG, 0) / 1_000_000,
    fleetWeightT: available.reduce((n, v) => n + v.weightCapG, 0) / 1_000_000,
    chilledM3: queue.filter((o) => o.tempRequirement === "chilled").reduce((n, o) => n + o.volumeL, 0) / 1000,
    reeferM3: reefers.reduce((n, v) => n + v.volumeCapL, 0) / 1000,
  };
}

/** Menu filtering needs only placement locks, without recalculating schedules or capacity for every option. */
export function lockedDraftChange(data: DraftData, reference: BrowserReference, context: ValidationContext) {
  return lockedStopChange(
    context.publishedStops ?? [],
    data.trips.flatMap((t) =>
      t.orderIds.map((orderId, index) => ({
        orderId,
        vehicleId: reference.vehicleDisplay.get(t.vehicleId) ?? t.vehicleId,
        tripNo: t.tripNo,
        seq: index + 1,
      })),
    ),
  );
}

/** Only wire UUIDs enter the browser; rules context consistently uses reference display IDs. */
export function validationContext(context: ApiDto<"planningContext">, reference: BrowserReference): ValidationContext {
  const vehicle = (id: string) => reference.vehicleDisplay.get(id) ?? id;
  const outlet = (id: string) => reference.outletDisplay.get(id) ?? id;
  return {
    publishedStops: context.publishedStops?.map((s) => ({ ...s, vehicleId: vehicle(s.vehicleId) })),
    fuelUsedThisWeekMl: new Map(
      context.vehicleFuel.map((item) => [vehicle(item.vehicleId), item.usedOtherDaysThisWeekMl]),
    ),
    deferredLastRunOutletIds: new Set(
      context.outletService.filter((item) => item.deferredLastRun).map((item) => outlet(item.outletId)),
    ),
    loadedOrders: new Map(
      context.loadedOrders.map((item) => [
        item.orderId,
        { vehicleId: vehicle(item.vehicleId), tripNo: item.tripNo, reversalRequested: item.reversalRequested },
      ]),
    ),
  };
}
