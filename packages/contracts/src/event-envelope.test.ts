import {
  CAUSE_KINDS as RULES_CAUSE_KINDS,
  HARD_CODES as RULES_HARD_CODES,
  ORDER_STATUSES as RULES_ORDER_STATUSES,
  REASON_CODES as RULES_REASON_CODES,
  SHORT_OUTCOMES as RULES_SHORT_OUTCOMES,
  WARN_CODES as RULES_WARN_CODES,
} from "@nextdrop/rules";
import { describe, expect, it } from "vitest";
import {
  CAUSE_KINDS,
  HARD_CODES,
  ORDER_STATUSES,
  PLANNING_DAY_STATES,
  REASON_CODES,
  SHORT_OUTCOMES,
  WARN_CODES,
  eventEnvelopeSchema,
  eventPayloadSchemas,
  EVENT_TYPES,
  parseEventEnvelope,
  type EventEnvelope,
  upcastPayload,
} from "./index";
import { invalidPayloadFor, assertFixtureCoverage } from "./test-support/invalid-payloads";
import { validPayloads } from "./test-support/fixtures";

describe("eventEnvelopeSchema", () => {
  it.each(EVENT_TYPES)("%s accepts a minimal valid envelope", (type) => {
    expect(eventEnvelopeSchema.safeParse(validPayloads[type]).success).toBe(true);
  });

  it.each(EVENT_TYPES)("%s rejects an invalid payload", (type) => {
    expect(eventPayloadSchemas[type].safeParse(invalidPayloadFor(type)).success).toBe(false);
  });

  it("rejects a schema version above the current one", () => {
    const bad = { ...validPayloads.ORDER_PLACED, schemaVersion: 99 };
    expect(eventEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("narrows payload by type", () => {
    const parsed = parseEventEnvelope(validPayloads.ORDER_PLANNED);
    const tripId = payloadTripId(parsed);
    expect(tripId).toBe(validPayloads.ORDER_PLANNED.payload.tripId);
  });
});

function payloadTripId(e: EventEnvelope): string | undefined {
  if (e.type === "ORDER_PLANNED") return e.payload.tripId;
  return undefined;
}

describe("vocab re-exports", () => {
  it("matches rules-owned literal arrays", () => {
    expect(ORDER_STATUSES).toEqual(RULES_ORDER_STATUSES);
    expect(REASON_CODES).toEqual(RULES_REASON_CODES);
    expect(CAUSE_KINDS).toEqual(RULES_CAUSE_KINDS);
    expect(HARD_CODES).toEqual(RULES_HARD_CODES);
    expect(WARN_CODES).toEqual(RULES_WARN_CODES);
    expect(SHORT_OUTCOMES).toEqual(RULES_SHORT_OUTCOMES);
    expect(PLANNING_DAY_STATES).toEqual(["OPEN", "CLOSED", "PLANNING", "PUBLISHED", "IN_PROGRESS", "COMPLETE"]);
  });
});

describe("fixtures", () => {
  it("covers every event type", () => {
    assertFixtureCoverage(EVENT_TYPES);
  });
});

describe("upcasters", () => {
  it("returns payload unchanged when the shared registry is empty", () => {
    const payload = { foo: 1 };
    expect(upcastPayload("ORDER_PLACED", 1, payload)).toEqual(payload);
  });
});
