import { z } from "zod";

/** UUID v7 on the wire (validated as UUID; version nibble not enforced). */
export const uuidV7 = z.uuid();

/** Server clock timestamps are stored as UTC (`Z`). Offset forms such as `+05:30` are rejected. */
export const isoDateTime = z.iso.datetime();

export const localDate = z.iso.date();

export const actorSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["STORE", "DISPATCHER", "LOADER", "DRIVER", "SYSTEM"]),
});

export const subjectSchema = z.object({
  orderId: uuidV7.optional(),
  tripId: uuidV7.optional(),
  vehicleId: uuidV7.optional(),
});

export const lineIdSchema = z.string().min(1);

export const shortLineSchema = z.object({
  lineId: lineIdSchema,
  qtyShort: z.number().int().nonnegative(),
});

export const damagedLineSchema = z.object({
  lineId: lineIdSchema,
  qty: z.number().int().nonnegative(),
});

export const loadedLineSchema = z.object({
  lineId: lineIdSchema,
  qtyLoaded: z.number().int().nonnegative(),
});

export const stopLineSchema = z.object({
  lineId: lineIdSchema,
  qtyDelivered: z.number().int().nonnegative().optional(),
  qtyReturned: z.number().int().nonnegative().optional(),
});
