import { describe, expect, it } from "vitest";
import * as c from "./index";

describe("API projections backed by the merged data model", () => {
  it("represents outlets with no address/contact and preserves driver phone requirements", () => {
    const outlet = { ...c.apiFixtures.outlet, name: "Waypoint Fresh, Colombo", address: null, contact: null };
    expect(c.outletSchema.parse(outlet)).toEqual(outlet);
    const linked = { ...outlet, contact: { name: "Store user", phone: null } };
    expect(c.outletSchema.parse(linked)).toEqual(linked);
    expect(c.vehicleSchema.safeParse({ ...c.apiFixtures.vehicle, driver: linked.contact }).success).toBe(false);
  });

  it("preserves trip-level conflicts and resolved outcomes in exported fixtures", () => {
    expect(c).toHaveProperty("apiConflictFixtures");
    for (const fixture of Object.values(c.apiConflictFixtures)) {
      expect(c.conflictSchema.parse(fixture)).toEqual(fixture);
      expect(c.exceptionSchema.parse({ type: "CONFLICT", conflict: fixture, evidence: [] })).toEqual({
        type: "CONFLICT",
        conflict: fixture,
        evidence: [],
      });
    }
    expect(c.apiConflictFixtures.tripLevel.orderId).toBeNull();
    expect(c.apiConflictFixtures.tripLevel.tripId).toBe(c.apiFixtures.trip.id);
    expect(c.apiConflictFixtures.resolved.resolution).toBe("ACCEPT_FACT");
  });

  it("includes the design's acknowledgement row with event actor and payload version", () => {
    const ack = {
      type: "ACK",
      tripId: c.apiFixtures.trip.id,
      planVersion: 1,
      actor: c.apiFixtures.clientEvent.actor,
      at: c.apiFixtures.clientEvent.capturedAt,
    };
    expect(c.exceptionSchema.parse(ack)).toEqual(ack);
    expect(c.apiVariantFixtures.exception).toHaveProperty("ACK");
    expect(c.exceptionSchema.safeParse({ ...ack, planVersion: "1" }).success).toBe(false);
  });

  it("reserves revision zero for a missing draft, with the first saved draft at one", () => {
    expect(c.draftSchema.safeParse({ ...c.apiFixtures.draft, revision: 0 }).success).toBe(false);
    expect(c.draftSchema.parse({ ...c.apiFixtures.draft, revision: 1 }).revision).toBe(1);
    expect(c.proposeRequestSchema.safeParse({ revision: 0 }).success).toBe(true);
  });
});
