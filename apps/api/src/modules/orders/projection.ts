import type { ApiDto, OrderDto, TripDto } from "@nextdrop/contracts";
import {
  colomboInstant,
  etaBand,
  kmToMetres,
  litresToMillilitres,
  parseWindow,
  reduceOrder,
  type OrderEvent,
} from "@nextdrop/rules";
import type { Prisma } from "../../generated/prisma/client";
import { localDateOf } from "./calendar";
import { insertionOrder, toRulesEvent } from "./events";

/** Everything an order DTO needs, in one include. */
export const orderInclude = {
  outlet: { select: { depot: true } },
  orderLine_orderId: {
    include: { product: { select: { sku: true, name: true, unitLabel: true } } },
    orderBy: { id: "asc" },
  },
  orderEvent_orderId: { orderBy: insertionOrder },
  tripStop_orderId: {
    // The order's current, non-cancelled stop (a partial unique index allows at most one).
    where: { tripStatus: { not: "CANCELLED" } },
    include: { trip: { select: { vehicleId: true, planningDay: { select: { date: true } } } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const iso = (ms: number) => new Date(ms).toISOString();
const grams = (kg: Prisma.Decimal) => kg.mul(1000).toNumber();

function latestApplied<T extends OrderEvent["type"]>(
  events: readonly OrderRecord["orderEvent_orderId"][number][],
  types: readonly T[],
) {
  return [...events]
    .reverse()
    .find((e) => e.disposition === "APPLIED" && (types as readonly string[]).includes(e.type));
}

export function toOrderDto(order: OrderRecord): OrderDto {
  const events = order.orderEvent_orderId;
  const state = reduceOrder(order.id, events.map(toRulesEvent));
  const stop = order.tripStop_orderId[0];
  let assignment: OrderDto["assignment"] = null;
  if (stop) {
    const date = localDateOf(stop.trip.planningDay.date);
    const band = etaBand(stop.etaMin);
    assignment = {
      tripId: stop.tripId,
      vehicleId: stop.trip.vehicleId,
      seq: stop.seq,
      etaFrom: iso(colomboInstant(date, band.open)),
      etaTo: iso(colomboInstant(date, band.close)),
    };
  }
  const deferred = order.status === "DEFERRED" ? latestApplied(events, ["ORDER_DEFERRED"]) : undefined;
  return {
    id: order.id,
    displayId: order.displayId,
    outletId: order.outletId,
    brand: order.brand,
    tempRequirement: order.tempRequirement,
    requestedDate: localDateOf(order.requestedDate),
    currentDate: localDateOf(order.currentDate),
    status: order.status,
    weightG: order.weightG,
    volumeL: order.volumeL,
    placedAt: order.placedAt.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    deferredCount: order.deferredCount,
    replacesOrderId: order.replacesOrderId,
    pendingReversal: state.pendingReversal
      ? { to: state.pendingReversal.to, planVersion: state.pendingReversal.planVersion }
      : null,
    lines: order.orderLine_orderId.map((line) => ({
      id: line.id,
      productId: line.productId,
      sku: line.product.sku,
      name: line.product.name,
      unitLabel: line.product.unitLabel,
      qtyOrdered: line.qtyOrdered,
      qtyLoaded: line.qtyLoaded,
      qtyDelivered: line.qtyDelivered,
      qtyReceived: line.qtyReceived,
      unitWeightG: grams(line.unitWeightKg),
      unitVolumeM3: line.unitVolumeM3.toNumber(),
    })),
    flags: {
      short: state.short.map((l) => ({ lineId: l.lineId, qtyShort: l.qtyShort, resolution: l.resolution })),
      damaged: state.damaged.map((l) => ({ lineId: l.lineId, qty: l.qty })),
    },
    assignment,
    deferral: deferred ? (toRulesEvent(deferred).payload as OrderDto["deferral"]) : null,
  };
}

export const outletInclude = {
  district: { select: { name: true } },
  user_outletId: { where: { role: "STORE" }, select: { displayName: true }, orderBy: { id: "asc" }, take: 1 },
} satisfies Prisma.OutletInclude;

export type OutletRecord = Prisma.OutletGetPayload<{ include: typeof outletInclude }>;

/** ADR 0024: derived name; no address source; contact only from a linked store user, without a phone. */
export function toOutletDto(outlet: OutletRecord): ApiDto<"outlet"> {
  const storeUser = outlet.user_outletId[0];
  const mall = outlet.mallWindow ? parseWindow(outlet.mallWindow) : null;
  return {
    id: outlet.id,
    displayId: outlet.displayId,
    name: `Waypoint ${outlet.brand}, ${outlet.district.name}`,
    brand: outlet.brand,
    district: outlet.district.name,
    depot: outlet.depot,
    dockType: outlet.dockType,
    parking: outlet.parkingConstraint,
    mallWindow: mall ? { open: mall.open, close: mall.close } : null,
    window: { open: outlet.windowOpen, close: outlet.windowClose },
    address: null,
    contact: storeUser ? { name: storeUser.displayName, phone: null } : null,
  };
}

/**
 * A trip with its stops. A store passes its `outletId` and sees only its own stops (spec/platform/auth.md, store
 * scope); field roles see every stop of a trip in their scope.
 */
export function tripInclude(outletId?: string) {
  return {
    district: { select: { name: true } },
    planningDay: { select: { date: true } },
    stops: {
      ...(outletId ? { where: { order: { outletId } } } : {}),
      orderBy: { seq: "asc" },
      include: { order: { include: { ...orderInclude, outlet: { include: outletInclude } } } },
    },
  } satisfies Prisma.TripInclude;
}

export type TripRecord = Prisma.TripGetPayload<{ include: ReturnType<typeof tripInclude> }>;

export function toTripDto(trip: TripRecord): TripDto {
  const date = localDateOf(trip.planningDay.date);
  return {
    id: trip.id,
    displayId: trip.displayId,
    vehicleId: trip.vehicleId,
    tripNo: trip.tripNo as 1 | 2,
    brand: trip.brand,
    district: trip.district.name,
    status: trip.status,
    plannedDepart: iso(colomboInstant(date, trip.plannedDepart)),
    plannedMinutes: trip.plannedMinutes,
    distanceM: kmToMetres(trip.km.toNumber()),
    fuelMl: litresToMillilitres(trip.litres.toNumber()),
    stops: trip.stops.map((stop) => {
      const events = stop.order.orderEvent_orderId;
      const arrived = latestApplied(events, ["STOP_ARRIVED"]);
      // Delivered on the driver's phone (capturedAt) and confirmed when the server received it, never merged.
      const delivered = [...events]
        .reverse()
        .find(
          (e) =>
            e.disposition === "APPLIED" &&
            e.type === "STOP_OUTCOME" &&
            ["FULL", "PARTIAL"].includes(String((e.payload as { outcome?: unknown }).outcome)),
        );
      const band = etaBand(stop.etaMin);
      return {
        id: stop.id,
        seq: stop.seq,
        order: toOrderDto(stop.order),
        outlet: toOutletDto(stop.order.outlet),
        etaFrom: iso(colomboInstant(date, band.open)),
        etaTo: iso(colomboInstant(date, band.close)),
        window: { open: stop.windowOpen, close: stop.windowClose },
        serviceMin: stop.serviceMin,
        arrivedAt: arrived?.capturedAt.toISOString() ?? null,
        deliveredAt: delivered?.capturedAt.toISOString() ?? null,
        confirmedAt: delivered?.receivedAt.toISOString() ?? null,
      };
    }),
  };
}
