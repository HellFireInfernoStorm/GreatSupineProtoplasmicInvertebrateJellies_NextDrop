// A planning day's inputs for the rules core (spec/rules-core/allocator.md §5.3 step 1): the confirmed queue, the
// available fleet, fuel already used this ISO week, and outlet service state. The API assembles them from canonical
// rows; a client never sends trusted order sizes (spec/platform/api-dtos.md).
import type { ApiDto } from "@nextdrop/contracts";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  litresToMillilitres,
  type AllocationInput,
  type AllocationOrder,
  type AllocationResult,
  type LoadedPin,
  type LocalDate,
  type Plan,
  type PlanOrder,
  type ValidationContext,
} from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { dateOnly, localDateOf, orderInclude, toOrderDto, type OrderRecord } from "../orders";
import type { Reference } from "./reference";

type DraftData = ApiDto<"draftData">;

/** Statuses an order can be planned from (validator PLANNABLE): the day's confirmed queue. */
export const QUEUE_STATUSES = ["ORDERED", "PLANNED", "DEFERRED", "FAILED", "LOADED"] as const;

/** An outlet never served counts as long unserved. */
const NEVER_SERVED_DAYS = 365;

export interface DayInputs {
  date: LocalDate;
  depot: string;
  reference: Reference;
  queue: OrderRecord[];
  allocation: AllocationInput;
  validation: ValidationContext & { date: LocalDate };
}

export async function loadDayInputs(
  prisma: PrismaClient,
  reference: Reference,
  depot: string,
  date: LocalDate,
): Promise<DayInputs> {
  const { ids } = reference;
  const day = dateOnly(date);
  const queue = await prisma.order.findMany({
    where: { currentDate: day, status: { in: [...QUEUE_STATUSES] }, outlet: { depot } },
    include: orderInclude,
    orderBy: { displayId: "asc" },
  });

  const outletIds = [...new Set(queue.map((o) => o.outletId))];
  const [services, workshop, loadedStops, fuel] = await Promise.all([
    prisma.outletServiceState.findMany({ where: { outletId: { in: outletIds } } }),
    prisma.vehicleAvailability.findMany({ where: { date: day, status: "IN_WORKSHOP" } }),
    prisma.tripStop.findMany({
      where: {
        orderId: { in: queue.filter((o) => o.status === "LOADED").map((o) => o.id) },
        tripStatus: { not: "CANCELLED" },
      },
      include: { trip: { select: { vehicleId: true, tripNo: true } } },
    }),
    fuelUsedThisWeek(prisma, date),
  ]);
  const service = new Map(services.map((s) => [s.outletId, s]));
  const vehicle = (uuid: string) => ids.vehicleDisplay.get(uuid) ?? uuid;

  const orders: AllocationOrder[] = queue.map((o) => {
    const state = service.get(o.outletId);
    return {
      id: o.id,
      outletId: ids.outletDisplay.get(o.outletId) ?? o.outletId,
      temp: o.tempRequirement,
      weightG: o.weightG,
      volumeL: o.volumeL,
      deliveryDate: date,
      status: o.status,
      brand: o.brand,
      requestedDate: localDateOf(o.requestedDate),
      deferredCount: o.deferredCount,
      deferredYesterday: state?.deferredLastRun ?? false,
      daysSinceLastServed: state?.lastServedDate
        ? Math.max(0, daysBetween(localDateOf(state.lastServedDate), date))
        : NEVER_SERVED_DAYS,
    };
  });

  const unavailableVehicleIds = new Set(workshop.map((w) => vehicle(w.vehicleId)));
  const breakdownVehicleIds = new Set(
    workshop.filter((w) => w.reason === "BREAKDOWN").map((w) => vehicle(w.vehicleId)),
  );
  const fuelUsedThisWeekMl = new Map([...fuel].map(([uuid, ml]) => [vehicle(uuid), ml]));
  const deferredLastRunOutletIds = new Set(
    services.filter((s) => s.deferredLastRun).map((s) => ids.outletDisplay.get(s.outletId) ?? s.outletId),
  );
  const pending = new Map(queue.map((o) => [o.id, toOrderDto(o).pendingReversal]));
  const loadedOrders = new Map<string, LoadedPin>(
    loadedStops.map((s) => [
      s.orderId,
      {
        vehicleId: vehicle(s.trip.vehicleId),
        tripNo: s.trip.tripNo,
        reversalRequested: pending.get(s.orderId) != null,
      },
    ]),
  );

  return {
    date,
    depot,
    reference,
    queue,
    allocation: { date, depot, orders, unavailableVehicleIds, breakdownVehicleIds, fuelUsedThisWeekMl },
    validation: { date, unavailableVehicleIds, fuelUsedThisWeekMl, deferredLastRunOutletIds, loadedOrders },
  };
}

/**
 * Fuel each vehicle used on the published, non-cancelled trips of the other days of `date`'s ISO week (ADR 0006).
 * Keyed by vehicle UUID, in millilitres.
 */
export async function fuelUsedThisWeek(prisma: PrismaClient, date: LocalDate): Promise<Map<string, number>> {
  const monday = addDays(date, -dayOfWeek(date));
  const trips = await prisma.trip.findMany({
    where: {
      status: { not: "CANCELLED" },
      planningDay: {
        state: { in: ["PUBLISHED", "IN_PROGRESS", "COMPLETE"] },
        date: { gte: dateOnly(monday), lte: dateOnly(addDays(monday, 6)), not: dateOnly(date) },
      },
    },
    select: { vehicleId: true, litres: true },
  });
  const used = new Map<string, number>();
  for (const t of trips) used.set(t.vehicleId, (used.get(t.vehicleId) ?? 0) + litresToMillilitres(t.litres.toNumber()));
  return used;
}

/** Draft data (UUIDs) as a rules plan (display IDs). Unknown orders and vehicles pass through for the validator. */
export function toRulesPlan(data: DraftData, inputs: DayInputs): Plan {
  const byId = new Map<string, PlanOrder>(inputs.allocation.orders.map((o) => [o.id, o]));
  const order = (id: string): PlanOrder =>
    byId.get(id) ?? { id, outletId: "", temp: "ambient", weightG: 0, volumeL: 0, deliveryDate: inputs.date };
  return {
    date: inputs.date,
    trips: data.trips.map((t) => ({
      ref: t.ref,
      vehicleId: inputs.reference.ids.vehicleDisplay.get(t.vehicleId) ?? t.vehicleId,
      tripNo: t.tripNo,
      orders: t.orderIds.map(order),
    })),
    orders: inputs.allocation.orders,
    deferrals: data.deferrals.map((d) => ({
      orderId: d.orderId,
      ...(d.reasonCode ? { reasonCode: d.reasonCode } : {}),
      ...(d.note ? { note: d.note } : {}),
    })),
  };
}

/** A proposal as draft data: trips with stops in delivery order, and every deferred order unassigned with its reason. */
export function toDraftData(result: AllocationResult, inputs: DayInputs): DraftData {
  const { vehicleUuid } = inputs.reference.ids;
  return {
    trips: result.trips.map((t) => ({
      ref: t.ref,
      vehicleId: vehicleUuid.get(t.vehicleId) ?? t.vehicleId,
      tripNo: t.tripNo as 1 | 2,
      orderIds: t.orders.map((o) => o.id),
    })),
    unassignedOrderIds: result.deferrals.map((d) => d.orderId),
    deferrals: result.deferrals.map((d) => ({ orderId: d.orderId, reasonCode: d.reasonCode })),
  };
}
