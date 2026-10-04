import { describe, expect, it } from "vitest";
import { computeRunSchedule, sequenceStops } from "./etas";
import { lockedStopChange, preserveDraftOrder, stopPlacements, type PublishedStop } from "./planning-locks";
import { order, trip } from "./test-support/orders";
import { loadReferenceData } from "./test-support/reference-csv";
import { validatePlan } from "./validator";

const ref = loadReferenceData();
const draft = trip("T160", "VEH039", 1, [order("L1", "OUT110"), order("L2", "OUT111"), order("EARLY", "OUT112")]);
const published: PublishedStop = {
  orderId: "L1",
  vehicleId: "VEH039",
  tripNo: 1,
  seq: 1,
  locked: false,
  departed: true,
};

describe("dispatcher draft ordering", () => {
  it("places an appended earliest-closing Badulla stop before later windows before departure", () => {
    const planTrip = { ...draft, preserveOrder: preserveDraftOrder(draft, []) };
    const validation = validatePlan({ date: "2026-10-06", trips: [planTrip] }, ref);
    expect(validation.violations.filter((v) => v.code === "WINDOW_MISSED")).toEqual([]);
    // The reference three-stop trip takes 277 minutes regardless of sequence; never relax the 270-minute budget.
    expect(validation.violations).toEqual([
      expect.objectContaining({
        code: "TIME_BUDGET_EXCEEDED",
        params: { limit: 270, actual: 277, budgetClass: "FRESH" },
      }),
    ]);
    expect(sequenceStops(planTrip, ref).map((o) => o.id)).toEqual(["EARLY", "L1", "L2"]);
    expect(computeRunSchedule([planTrip], ref)[0]!.stops.map((s) => s.orderId)).toEqual(["EARLY", "L1", "L2"]);
    expect(
      validatePlan({ date: "2026-10-06", trips: [{ ...draft, preserveOrder: true }] }, ref).violations,
    ).toContainEqual(expect.objectContaining({ code: "WINDOW_MISSED", orderIds: ["EARLY"] }));
  });
  it("keeps draft order only when a published stop on that vehicle and trip has departed", () => {
    const planTrip = { ...draft, preserveOrder: preserveDraftOrder(draft, [published]) };
    expect(sequenceStops(planTrip, ref).map((o) => o.id)).toEqual(["L1", "L2", "EARLY"]);
    expect(computeRunSchedule([planTrip], ref)[0]!.stops.map((s) => s.orderId)).toEqual(["L1", "L2", "EARLY"]);
    for (const context of [
      [],
      [{ ...published, departed: false, locked: true }],
      [{ ...published, vehicleId: "VEH040" }],
      [{ ...published, tripNo: 2 }],
    ]) {
      expect(preserveDraftOrder(draft, context)).toBe(false);
    }
    // Even removing the trip's last published order from a draft must not erase its departed state.
    expect(preserveDraftOrder({ vehicleId: draft.vehicleId, tripNo: draft.tripNo }, [published])).toBe(true);
  });
  it("compares loaded undeparted locks with delivery sequence rather than insertion order", () => {
    const current = ["EARLY", "L1", "L2"].map((orderId, index) => ({
      ...published,
      orderId,
      seq: index + 1,
      locked: true,
      departed: false,
    }));
    const planTrip = { ...draft, preserveOrder: preserveDraftOrder(draft, current) };
    const placements = stopPlacements({ trips: [planTrip] }, ref);
    expect(placements.map((stop) => [stop.orderId, stop.seq])).toEqual([
      ["EARLY", 1],
      ["L1", 2],
      ["L2", 3],
    ]);
    expect(lockedStopChange(current, placements)).toBeNull();
    expect(lockedStopChange(current, stopPlacements({ trips: [{ ...planTrip, tripNo: 2 }] }, ref))).toBe("EARLY");
    const invalid = { ...planTrip, orders: [order("UNKNOWN", "missing")] };
    expect(stopPlacements({ trips: [invalid] }, ref)).toEqual([
      { orderId: "UNKNOWN", vehicleId: "VEH039", tripNo: 1, seq: 1 },
    ]);
  });
});
