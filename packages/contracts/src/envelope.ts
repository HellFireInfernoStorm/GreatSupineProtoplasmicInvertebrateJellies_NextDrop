import type { OrderEvent } from "@nextdrop/rules";
import { z } from "zod";
import { EVENT_TYPES, type EventType } from "./event-types";
import { eventPayloadSchemas, type EventPayloadMap } from "./event-payload";
import { actorSchema, isoDateTime, subjectSchema, uuidV7 } from "./primitives";
import { schemaVersion } from "./schema-version";

export const eventEnvelopeBase = z.object({
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

export type EnvelopeBase = z.infer<typeof eventEnvelopeBase>;

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

/** Discriminated at the type level; `eventEnvelopeSchema` is the runtime check. */
export type EventEnvelope = {
  [K in EventType]: EnvelopeBase & { type: K; payload: EventPayloadMap[K] };
}[EventType];

export function parseEventEnvelope(input: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(input) as EventEnvelope;
}

type _AssignableToOrderEvent = EventEnvelope extends OrderEvent ? true : never;
const _eventEnvelopeAssignableToOrderEvent: _AssignableToOrderEvent = true;
void _eventEnvelopeAssignableToOrderEvent;
