import {
  BRANDS,
  DOCK_TYPES,
  PARKING_CONSTRAINTS,
  TEMP_REQUIREMENTS,
  VEHICLE_TEMPS,
  VEHICLE_TYPES,
} from "@nextdrop/rules";
import { z } from "zod";
import { eventEnvelopeSchema } from "../envelope";
import { orderDeferredPayloadSchema } from "../payloads/order-lifecycle";
import { isoDateTime, localDate, uuidV7 } from "../primitives";
import { orderFlagSchema, orderStatusSchema, tripStatusSchema } from "../vocab";
import { count, minute, nonempty } from "./common";

export const windowSchema = z.strictObject({ open: minute, close: minute });
export const contactSchema = z.strictObject({ name: nonempty, phone: nonempty.nullable() });
export const outletSchema = z.strictObject({
  id: uuidV7,
  displayId: nonempty,
  name: nonempty,
  brand: z.enum(BRANDS),
  district: nonempty,
  depot: nonempty,
  dockType: z.enum(DOCK_TYPES),
  parking: z.enum(PARKING_CONSTRAINTS),
  mallWindow: windowSchema.nullable(),
  window: windowSchema,
  address: nonempty.nullable(),
  contact: contactSchema.nullable(),
});
export const vehicleSchema = z.strictObject({
  id: uuidV7,
  displayId: nonempty,
  type: z.enum(VEHICLE_TYPES),
  temp: z.enum(VEHICLE_TEMPS),
  weightCapG: count,
  volumeCapL: count,
  fuelType: nonempty,
  metresPerLitre: z.number().positive(),
  weeklyFuelQuotaMl: count,
  depot: nonempty,
  driver: contactSchema.extend({ phone: nonempty }),
});
export const productSchema = z.strictObject({
  id: uuidV7,
  sku: nonempty,
  name: nonempty,
  brand: z.enum(BRANDS),
  tempRequirement: z.enum(TEMP_REQUIREMENTS),
  unitLabel: nonempty,
  unitWeightG: z.number().nonnegative(),
  unitVolumeM3: z.number().nonnegative(),
});
export const calendarDaySchema = z.strictObject({
  date: localDate,
  dow: count.max(6),
  isoYear: count,
  isoWeek: z.number().int().min(1).max(53),
  isPayday: z.boolean(),
  festival: nonempty.nullable(),
  festivalRamp: z.number().nonnegative(),
  isHoliday: z.boolean(),
  monsoon: z.boolean(),
  isOperating: z.boolean(),
});
export const orderLineSchema = z.strictObject({
  id: nonempty,
  productId: uuidV7,
  sku: nonempty,
  name: nonempty,
  unitLabel: nonempty,
  qtyOrdered: z.number().int().positive(),
  qtyLoaded: count,
  qtyDelivered: count,
  qtyReceived: count,
  unitWeightG: z.number().nonnegative(),
  unitVolumeM3: z.number().nonnegative(),
});
export const orderSchema = z.strictObject({
  id: uuidV7,
  displayId: nonempty,
  outletId: uuidV7,
  brand: z.enum(BRANDS),
  tempRequirement: z.enum(TEMP_REQUIREMENTS),
  requestedDate: localDate,
  currentDate: localDate,
  status: orderStatusSchema,
  weightG: count,
  volumeL: count,
  placedAt: isoDateTime,
  confirmedAt: isoDateTime.nullable(),
  deferredCount: count,
  replacesOrderId: uuidV7.nullable(),
  lines: z.array(orderLineSchema).min(1),
  flags: orderFlagSchema,
  assignment: z
    .strictObject({ tripId: uuidV7, vehicleId: uuidV7, seq: count, etaFrom: isoDateTime, etaTo: isoDateTime })
    .nullable(),
  deferral: orderDeferredPayloadSchema.nullable(),
});
export const orderDetailSchema = z.strictObject({ order: orderSchema, timeline: z.array(eventEnvelopeSchema) });
export const stopSchema = z.strictObject({
  id: uuidV7,
  seq: count,
  order: orderSchema,
  outlet: outletSchema,
  etaFrom: isoDateTime,
  etaTo: isoDateTime,
  window: windowSchema,
  serviceMin: count,
  arrivedAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
  confirmedAt: isoDateTime.nullable(),
});
export const tripSchema = z.strictObject({
  id: uuidV7,
  displayId: nonempty,
  vehicleId: uuidV7,
  tripNo: z.union([z.literal(1), z.literal(2)]),
  brand: z.enum(BRANDS),
  district: nonempty,
  status: tripStatusSchema,
  plannedDepart: isoDateTime,
  plannedMinutes: count,
  distanceM: count,
  fuelMl: count,
  stops: z.array(stopSchema),
});
export type OrderDto = z.infer<typeof orderSchema>;
export type TripDto = z.infer<typeof tripSchema>;
export const resourceSchemas = {
  window: windowSchema,
  contact: contactSchema,
  outlet: outletSchema,
  vehicle: vehicleSchema,
  product: productSchema,
  calendarDay: calendarDaySchema,
  orderLine: orderLineSchema,
  order: orderSchema,
  orderDetail: orderDetailSchema,
  stop: stopSchema,
  trip: tripSchema,
};
