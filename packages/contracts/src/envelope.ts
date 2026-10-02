import { z } from "zod";
import { EVENT_TYPES } from "./event-types";
import { eventPayloadSchemas } from "./event-payload";
import { actorSchema, isoDateTime, subjectSchema, uuidV7 } from "./primitives";
import { schemaVersion } from "./schema-version";

const eventEnvelopeBase = z.object({
  id: uuidV7,
  clientEventId: uuidV7.optional(),
  deviceId: uuidV7.optional(),
  deviceSeq: z.number().int().nonnegative().optional(),
  schemaVersion,
  subject: subjectSchema,
  source: z.enum(["SERVER", "FIELD"]),
  actor: actorSchema,
  capturedAt: isoDateTime,
  clockOffsetMs: z.number().int().optional(),
  receivedAt: isoDateTime,
  basedOnPlanVersion: z.number().int().nonnegative().optional(),
  disposition: z.enum(["APPLIED", "HELD"]),
});

const envelopeVariants = EVENT_TYPES.map((type) =>
  eventEnvelopeBase.extend({
    type: z.literal(type),
    payload: eventPayloadSchemas[type],
  }),
);

export const eventEnvelopeSchema = z.discriminatedUnion(
  "type",
  envelopeVariants as [(typeof envelopeVariants)[0], ...(typeof envelopeVariants)[number][]],
);

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
