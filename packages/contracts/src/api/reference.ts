import { z } from "zod";
import { localDate } from "../primitives";
import { deferralReasonCodeSchema, loadDamagedReasonCodeSchema, problemKindSchema } from "../vocab";
import { nonempty } from "./common";
import { outletSchema, vehicleSchema, productSchema, calendarDaySchema } from "./resources";

export const referenceQuerySchema = z.strictObject({ depot: nonempty.optional() });
export const calendarQuerySchema = z.strictObject({ from: localDate, to: localDate });
export const outletsResponseSchema = z.strictObject({ items: z.array(outletSchema) });
export const vehiclesResponseSchema = z.strictObject({ items: z.array(vehicleSchema) });
export const productsResponseSchema = z.strictObject({ items: z.array(productSchema) });
export const calendarResponseSchema = z.strictObject({ items: z.array(calendarDaySchema) });
export const reasonsResponseSchema = z.strictObject({
  deferral: z.array(z.strictObject({ code: deferralReasonCodeSchema, message_key: nonempty })),
  problems: z.array(z.strictObject({ code: problemKindSchema, message_key: nonempty })),
  loadShort: z.array(z.strictObject({ code: nonempty, message_key: nonempty })),
  loadDamaged: z.array(z.strictObject({ code: loadDamagedReasonCodeSchema, message_key: nonempty })),
  stopOutcome: z.array(z.strictObject({ code: nonempty, message_key: nonempty })),
});
export const referenceSchemas = {
  referenceQuery: referenceQuerySchema,
  calendarQuery: calendarQuerySchema,
  outletsResponse: outletsResponseSchema,
  vehiclesResponse: vehiclesResponseSchema,
  productsResponse: productsResponseSchema,
  calendarResponse: calendarResponseSchema,
  reasonsResponse: reasonsResponseSchema,
};
