import { CAUSE_KINDS, HARD_CODES, ORDER_STATUSES, REASON_CODES, WARN_CODES } from "@nextdrop/rules";
import { describe, expect, it } from "vitest";
import { eventEnvelopeSchema } from "./envelope";
import { eventPayloadSchemas } from "./event-payload";
import { EVENT_TYPES } from "./event-types";
import { createUpcasterRegistry, upcastPayload } from "./upcasters";
import { invalidPayloadFor } from "./test-support/invalid-payloads";
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
});

describe("vocab re-exports", () => {
  it("matches rules-owned literal arrays", () => {
    expect(ORDER_STATUSES.length).toBeGreaterThan(0);
    expect(REASON_CODES.length).toBe(11);
    expect(CAUSE_KINDS).toEqual(["UNAVOIDABLE_INFEASIBLE", "UNAVOIDABLE_POOL_EXHAUSTED", "CHOICE"]);
    expect(HARD_CODES).toContain("ORDER_ALREADY_LOADED");
    expect(WARN_CODES).toContain("LATE_RISK");
  });
});

describe("upcasters", () => {
  it("returns payload unchanged when the registry is empty", () => {
    const registry = createUpcasterRegistry();
    const payload = { foo: 1 };
    expect(upcastPayload(registry, "ORDER_PLACED", 1, payload)).toEqual(payload);
  });
});
