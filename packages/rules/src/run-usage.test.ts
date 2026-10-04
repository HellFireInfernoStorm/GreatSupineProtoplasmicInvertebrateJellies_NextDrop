import { describe, expect, it } from "vitest";
import { resolveRulesConfig } from "./config";
import { computeFuel } from "./fuel";
import { runUsage } from "./run-usage";
import { order, trip } from "./test-support/orders";
import { loadReferenceData } from "./test-support/reference-csv";
import { validatePlan } from "./validator";

const ref = loadReferenceData();
const vehicle = ref.vehicles.get("VEH001")!;
const first = trip("T1", vehicle.id, 1, [order("G1", "OUT026"), order("G2", "OUT030"), order("G3", "OUT028")]);
const second = trip("T2", vehicle.id, 2, [
  order("C1", "OUT004"),
  order("C2", "OUT006"),
  order("C3", "OUT007"),
  order("C4", "OUT014"),
]);
const date = "2026-10-06";

describe("run usage shared by meters and validation", () => {
  it("counts sibling Fresh trips and integer weekly fuel, excluding other vehicles", () => {
    const usage = runUsage([first, second, trip("OTHER", "VEH002", 1, first.orders)], vehicle, ref, {
      fuelUsedThisWeekMl: new Map([[vehicle.id, 12_345]]),
    });
    expect(usage.minutesByClass).toEqual({ FRESH: 213, STYLE_TECH: 0 });
    expect(usage.budgetByClass).toEqual({ FRESH: 270, STYLE_TECH: 480 });
    expect(usage.plannedFuelMl).toBe(
      computeFuel(first, vehicle, ref).millilitres + computeFuel(second, vehicle, ref).millilitres,
    );
    expect(usage.weekFuelMl).toBe(usage.plannedFuelMl + 12_345);
  });

  it("uses configured budgets/fuel and exposes the exact validator comparison values", () => {
    const ctx = {
      cfg: resolveRulesConfig({ freshBudgetMin: 100, fuelIncludeReturn: false }),
      fuelUsedThisWeekMl: new Map([[vehicle.id, vehicle.weeklyFuelQuotaMl]]),
    };
    const usage = runUsage([first, second], vehicle, ref, ctx);
    const result = validatePlan({ date, trips: [first, second] }, ref, ctx);
    expect(result.violations.find((v) => v.code === "TIME_BUDGET_EXCEEDED")?.params).toMatchObject({
      actual: usage.minutesByClass.FRESH,
      limit: usage.budgetByClass.FRESH,
    });
    expect(result.violations.find((v) => v.code === "FUEL_QUOTA_EXCEEDED")?.params).toMatchObject({
      actual: usage.weekFuelMl,
      limit: usage.fuelQuotaMl,
    });
    expect(usage.fuelByTripMl.get(first.ref)).toBe(computeFuel(first, vehicle, ref, ctx.cfg).millilitres);
  });

  it("excludes a trip with an unknown first district from both meters and checks", () => {
    const districts = new Map(ref.districts);
    districts.delete(ref.outlets.get(first.orders[0]!.outletId)!.district);
    const incomplete = { ...ref, districts };
    const ctx = { cfg: resolveRulesConfig({ freshBudgetMin: 0 }) };
    const usage = runUsage([first], vehicle, incomplete, ctx);
    expect(usage.schedules).toEqual([]);
    expect(usage.plannedFuelMl).toBe(0);
    expect(usage.minutesByClass.FRESH).toBe(0);
    expect(
      validatePlan({ date, trips: [first] }, incomplete, ctx).violations.some((v) => v.code === "TIME_BUDGET_EXCEEDED"),
    ).toBe(false);
  });

  it("retains known orders when an unknown outlet occurs first, matching validation", () => {
    const partial = { ...first, orders: [order("UNKNOWN", "MISSING"), ...first.orders] };
    const ctx = { cfg: resolveRulesConfig({ freshBudgetMin: 0 }) };
    const usage = runUsage([partial], vehicle, ref, ctx);
    expect(usage.minutesByClass.FRESH).toBe(runUsage([first], vehicle, ref, ctx).minutesByClass.FRESH);
    const result = validatePlan({ date, trips: [partial] }, ref, ctx);
    expect(result.violations.some((v) => v.code === "ORDER_UNASSIGNED_UNKNOWN")).toBe(true);
    expect(result.violations.find((v) => v.code === "TIME_BUDGET_EXCEEDED")?.params.actual).toBe(
      usage.minutesByClass.FRESH,
    );
  });

  it("keeps Style and Tech in their shared class separately from Fresh", () => {
    const style = [...ref.outlets.values()].find((o) => o.brand === "Style")!;
    const tech = [...ref.outlets.values()].find((o) => o.brand === "Tech")!;
    const trips = [
      first,
      trip("STYLE", vehicle.id, 2, [order("S", style.id)]),
      trip("TECH", vehicle.id, 3, [order("T", tech.id)]),
    ];
    const usage = runUsage(trips, vehicle, ref);
    expect(usage.minutesByClass.FRESH).toBe(101);
    expect(usage.minutesByClass.STYLE_TECH).toBe(runUsage(trips.slice(1), vehicle, ref).minutesByClass.STYLE_TECH);
    expect(usage.minutesByClass.STYLE_TECH).toBeGreaterThan(0);
  });

  it("handles empty runs and does not drop fuel on duplicate trip refs", () => {
    expect(runUsage([], vehicle, ref, { fuelUsedThisWeekMl: new Map([[vehicle.id, 123]]) }).weekFuelMl).toBe(123);
    const duplicate = { ...second, ref: first.ref };
    expect(runUsage([first, duplicate], vehicle, ref).plannedFuelMl).toBe(
      runUsage([first, second], vehicle, ref).plannedFuelMl,
    );
  });
});
