import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AllocationInput, AllocationResult } from "./allocator";
import { explainDeferral, proposePlan, REASON_CODES } from "./allocator";
import { DEFAULT_RULES_CONFIG } from "./config";
import type { PlanTrip } from "./plan";
import type { AllocationOrder } from "./ranking";
import { rankOrders } from "./ranking";
import { PEAK_DATE, peakDay, prng } from "./test-support/peak-day";
import { loadReferenceData } from "./test-support/reference-csv";
import { validatePlan } from "./validator";

const ref = loadReferenceData();
const calendar = ref.calendar;
const DATE = PEAK_DATE;

function ao(id: string, outletId: string, extra: Partial<AllocationOrder> = {}): AllocationOrder {
  const outlet = ref.outlets.get(outletId);
  if (!outlet) throw new Error(`fixture outlet ${outletId}`);
  return {
    id,
    outletId,
    brand: outlet.brand,
    temp: "ambient",
    weightG: 200_000,
    volumeL: 1_000,
    deliveryDate: DATE,
    requestedDate: DATE,
    status: "ORDERED",
    deferredCount: 0,
    deferredYesterday: false,
    daysSinceLastServed: 1,
    ...extra,
  };
}

function validates(input: AllocationInput, result: AllocationResult) {
  return validatePlan({ date: input.date, trips: result.trips }, ref, {
    unavailableVehicleIds: input.unavailableVehicleIds,
    fuelUsedThisWeekMl: input.fuelUsedThisWeekMl,
  });
}

/** Independent of the allocator: can `order` be added to `trips` anywhere without a HARD violation? */
function insertable(order: AllocationOrder, trips: readonly PlanTrip[], input: AllocationInput): boolean {
  const ctx = { unavailableVehicleIds: input.unavailableVehicleIds, fuelUsedThisWeekMl: input.fuelUsedThisWeekMl };
  const ok = (vehicleTrips: PlanTrip[]) =>
    !validatePlan({ date: input.date, trips: vehicleTrips }, ref, ctx).violations.some((v) => v.severity === "HARD");
  for (const v of ref.vehicles.values()) {
    if (v.depot !== input.depot || input.unavailableVehicleIds?.has(v.id)) continue;
    const mine = trips.filter((t) => t.vehicleId === v.id).sort((a, b) => a.tripNo - b.tripNo);
    for (let i = 0; i < mine.length; i++) {
      const variant = mine.map((t, j) => (j === i ? { ...t, orders: [...t.orders, order] } : t));
      if (ok(variant)) return true;
    }
    if (mine.length < 2) {
      const fresh: PlanTrip = { ref: "NEW", vehicleId: v.id, tripNo: 0, orders: [order] };
      const after = [...mine, fresh].map((t, j) => ({ ...t, tripNo: j + 1 }));
      const before = [fresh, ...mine].map((t, j) => ({ ...t, tripNo: j + 1 }));
      if (ok(after) || ok(before)) return true;
    }
  }
  return false;
}

// ---- Ranking --------------------------------------------------------------------------------------------------------

describe("rankOrders (ADR 0009, ADR 0022)", () => {
  const ctx = { date: DATE, calendar };

  it("orders the classes chilled Fresh, other Fresh, Style/Tech deferred yesterday, stale, remaining", () => {
    const orders = [
      ao("style-rest", "OUT019"),
      ao("style-stale", "OUT020", { daysSinceLastServed: 9 }),
      ao("tech-yday", "OUT023", { deferredYesterday: true }),
      ao("fresh-dry", "OUT004"),
      ao("fresh-chilled", "OUT006", { temp: "chilled" }),
    ];
    expect(rankOrders(orders, DEFAULT_RULES_CONFIG, ctx).map((r) => [r.order.id, r.scoreInputs.priorityClass])).toEqual(
      [
        ["fresh-chilled", "CHILLED_FRESH"],
        ["fresh-dry", "OTHER_FRESH"],
        ["tech-yday", "STYLE_TECH_DEFERRED_YESTERDAY"],
        ["style-stale", "STYLE_TECH_DAYS_SINCE_SERVED"],
        ["style-rest", "STYLE_TECH_REMAINING"],
      ],
    );
  });

  it("never lets a Style order deferred yesterday outrank chilled Fresh (the ADR 0009 case)", () => {
    const r = rankOrders(
      [
        ao("big-style", "OUT019", { deferredYesterday: true, volumeL: 12_000 }),
        ao("milk", "OUT004", { temp: "chilled" }),
      ],
      DEFAULT_RULES_CONFIG,
      ctx,
    );
    expect(r[0]?.order.id).toBe("milk");
  });

  it("aging guard sorts an order deferred twice first within its class, never above chilled Fresh", () => {
    const r = rankOrders(
      [
        ao("dry-new", "OUT004", { daysSinceLastServed: 9 }),
        ao("dry-aged", "OUT006", { deferredCount: 2 }),
        ao("chilled", "OUT007", { temp: "chilled" }),
      ],
      DEFAULT_RULES_CONFIG,
      ctx,
    );
    expect(r.map((x) => x.order.id)).toEqual(["chilled", "dry-aged", "dry-new"]);
  });

  it("inside Fresh classes: deferred yesterday first, then most days since served", () => {
    const r = rankOrders(
      [
        ao("a", "OUT004", { daysSinceLastServed: 3 }),
        ao("b", "OUT006", { daysSinceLastServed: 5 }),
        ao("c", "OUT007", { deferredYesterday: true }),
      ],
      DEFAULT_RULES_CONFIG,
      ctx,
    );
    expect(r.map((x) => x.order.id)).toEqual(["c", "b", "a"]);
  });

  it("class 5 ranks a larger slip higher, so the smallest-slip orders move first", () => {
    const r = rankOrders(
      [ao("today", "OUT019"), ao("since-friday", "OUT020", { requestedDate: "2026-09-25" })],
      DEFAULT_RULES_CONFIG,
      ctx,
    );
    expect(r.map((x) => [x.order.id, x.scoreInputs.slip])).toEqual([
      ["since-friday", 4],
      ["today", 1],
    ]);
  });

  it("breaks ties by larger volume, then order id", () => {
    const r = rankOrders(
      [ao("b", "OUT004"), ao("a", "OUT006"), ao("c", "OUT007", { volumeL: 2_000 })],
      DEFAULT_RULES_CONFIG,
      ctx,
    );
    expect(r.map((x) => x.order.id)).toEqual(["c", "a", "b"]);
  });

  it("snapshot: the ranking on a story-day-like fixture", () => {
    const story = [
      ao("ORD10412", "OUT004", {
        temp: "chilled",
        requestedDate: "2026-09-27",
        deferredCount: 1,
        deferredYesterday: true,
        volumeL: 1_600,
      }),
      ao("ORD10468", "OUT004", { volumeL: 2_200 }),
      ao("ORD10441", "OUT023", { daysSinceLastServed: 8, volumeL: 3_000 }),
      ao("ORD10462", "OUT024", { volumeL: 2_500 }),
      ao("ORD10457", "OUT019", { volumeL: 9_000 }),
      ao("ORD10453", "OUT007", { temp: "chilled", volumeL: 1_200 }),
      ao("ORD10470", "OUT026", { deferredCount: 2, requestedDate: "2026-09-26", volumeL: 1_800 }),
      ao("ORD10475", "OUT020", { deferredYesterday: true, volumeL: 6_000 }),
      ao("ORD10480", "OUT037", { requestedDate: "2026-09-28", volumeL: 5_000 }),
      ao("ORD10481", "OUT028", { daysSinceLastServed: 4, volumeL: 2_000 }),
    ];
    expect(
      rankOrders(story, DEFAULT_RULES_CONFIG, ctx).map((r) => `${r.rank} ${r.order.id} ${r.scoreInputs.priorityClass}`),
    ).toEqual([
      "0 ORD10412 CHILLED_FRESH",
      "1 ORD10453 CHILLED_FRESH",
      "2 ORD10470 OTHER_FRESH",
      "3 ORD10481 OTHER_FRESH",
      "4 ORD10468 OTHER_FRESH",
      "5 ORD10475 STYLE_TECH_DEFERRED_YESTERDAY",
      "6 ORD10441 STYLE_TECH_DAYS_SINCE_SERVED",
      "7 ORD10480 STYLE_TECH_REMAINING",
      "8 ORD10457 STYLE_TECH_REMAINING",
      "9 ORD10462 STYLE_TECH_REMAINING",
    ]);
  });
});

// ---- proposePlan on the peak day -------------------------------------------------------------------------------------

describe("proposePlan on a peak day", () => {
  const input = peakDay(ref);
  const t0 = performance.now();
  const result = proposePlan(input, ref);
  const elapsed = performance.now() - t0;

  it("proposes within 2 s for about 86 orders and the full fleet", () => {
    expect(input.orders.length).toBe(86);
    expect(ref.vehicles.size).toBe(60);
    expect(elapsed).toBeLessThan(2000);
  });

  it("is a real peak day: demand exceeds what can be served", () => {
    expect(result.stats.deferred).toBeGreaterThan(0);
    expect(result.stats.served + result.stats.deferred).toBe(86);
  });

  it("passes validatePlan", () => {
    expect(validates(input, result).violations.filter((v) => v.severity === "HARD")).toEqual([]);
  });

  it("uses no workshop vehicle", () => {
    expect(result.trips.some((t) => input.unavailableVehicleIds?.has(t.vehicleId))).toBe(false);
  });

  it("is single-insertion maximal: no deferred order fits the final plan", () => {
    const byId = new Map(input.orders.map((o) => [o.id, o]));
    for (const d of result.deferrals)
      expect(insertable(byId.get(d.orderId) as AllocationOrder, result.trips, input)).toBe(false);
  });

  it("explains every deferral with a reason, a cause, score inputs and consequences", () => {
    for (const d of result.deferrals) {
      expect(REASON_CODES).toContain(d.reasonCode);
      expect(d.causeKind).not.toBe("CHOICE");
      expect(d.scoreInputs).not.toBeNull();
      expect(d.nextServiceableDate).toBe("2026-09-30");
      expect(d.daysUnserved).toBeGreaterThanOrEqual(1);
      expect(d.consecutiveDeferrals).toBeGreaterThanOrEqual(1);
    }
  });

  it("names only equal or higher-priority orders as displacing a deferral", () => {
    const rank = new Map(
      rankOrders(input.orders, DEFAULT_RULES_CONFIG, { date: DATE, calendar }).map((r) => [r.order.id, r.rank]),
    );
    for (const d of result.deferrals) {
      for (const e of d.displacedBy) expect(rank.get(e) ?? 0).toBeLessThanOrEqual(rank.get(d.orderId) ?? 0);
    }
  });

  it("numbers trips and sequences stops", () => {
    expect(result.trips.map((t) => t.ref)).toEqual(result.trips.map((_, i) => `T${String(i + 1).padStart(3, "0")}`));
    expect(result.trace.at(-1)).toMatch(/served on \d+ trips/);
  });

  it("is deterministic, whatever the input order", () => {
    const again = proposePlan(input, ref);
    expect(again).toEqual(result);
    const shuffled = [...input.orders].reverse();
    expect(proposePlan({ ...input, orders: shuffled }, ref)).toEqual(result);
  });
});

describe("deferral explanations", () => {
  it("UNAVOIDABLE_INFEASIBLE when only a workshop vehicle could carry it (breakdown named, ADR 0017)", () => {
    // OUT001 is van-only and the order is chilled: only the two Peliyagoda reefer vans (VEH035, VEH036) can carry it.
    const order = ao("ORDX", "OUT001", { temp: "chilled" });
    const input: AllocationInput = {
      date: DATE,
      depot: "Peliyagoda",
      orders: [order],
      unavailableVehicleIds: new Set(["VEH035", "VEH036"]),
      breakdownVehicleIds: new Set(["VEH035", "VEH036"]),
    };
    const [d] = proposePlan(input, ref).deferrals;
    expect(d).toMatchObject({
      orderId: "ORDX",
      causeKind: "UNAVOIDABLE_INFEASIBLE",
      reasonCode: "VEHICLE_BREAKDOWN",
      bindingConstraint: "VEHICLE_UNAVAILABLE",
    });
    const [w] = proposePlan({ ...input, breakdownVehicleIds: new Set() }, ref).deferrals;
    expect(w?.reasonCode).toBe("VEHICLE_IN_WORKSHOP");
  });

  it("UNAVOIDABLE_INFEASIBLE when the order exceeds every vehicle", () => {
    const [d] = proposePlan(
      { date: DATE, depot: "Peliyagoda", orders: [ao("HUGE", "OUT019", { weightG: 9_000_000 })] },
      ref,
    ).deferrals;
    expect(d).toMatchObject({
      causeKind: "UNAVOIDABLE_INFEASIBLE",
      reasonCode: "CAPACITY_WEIGHT",
      bindingConstraint: "WEIGHT_CAP_EXCEEDED",
    });
  });

  it("UNAVOIDABLE_POOL_EXHAUSTED names the binding constraint and the higher-priority orders holding it", () => {
    // One reefer van available, two chilled van-only orders that cannot share a trip (capacity).
    const unavailable = new Set([...ref.vehicles.values()].filter((v) => v.id !== "VEH035").map((v) => v.id));
    const a = ao("A", "OUT001", { temp: "chilled", weightG: 600_000, volumeL: 4_000, deferredYesterday: true });
    const b = ao("B", "OUT002", { temp: "chilled", weightG: 600_000, volumeL: 4_000 });
    const c = ao("C", "OUT003", { temp: "chilled", weightG: 600_000, volumeL: 4_000 });
    const r = proposePlan(
      { date: DATE, depot: "Peliyagoda", orders: [a, b, c], unavailableVehicleIds: unavailable },
      ref,
    );
    expect(r.trips.flatMap((t) => t.orders.map((o) => o.id)).sort()).toEqual(["A", "B"]);
    expect(r.deferrals).toEqual([
      expect.objectContaining({
        orderId: "C",
        causeKind: "UNAVOIDABLE_POOL_EXHAUSTED",
        reasonCode: "REEFER_SHORTAGE",
        displacedBy: ["A", "B"],
      }),
    ]);
  });

  it("CHOICE when the dispatcher leaves out an order that still fits", () => {
    const style = ao("S", "OUT019");
    const e = explainDeferral(style, { date: DATE, trips: [] }, ref);
    expect(e).toMatchObject({ causeKind: "CHOICE", reasonCode: "MOVED_BY_POLICY", bindingConstraint: null });
    const fresh = explainDeferral(ao("F", "OUT004"), { date: DATE, trips: [] }, ref);
    expect(fresh).toMatchObject({ causeKind: "CHOICE", reasonCode: "OTHER" });
  });

  it("computes the consequences: next serviceable date, days unserved, consecutive deferrals (ADR 0010)", () => {
    // Saturday 3 Oct: the next operating date is Monday 5 Oct.
    const order = ao("SAT", "OUT019", { deliveryDate: "2026-10-03", requestedDate: "2026-10-02", deferredCount: 1 });
    const e = explainDeferral(order, { date: "2026-10-03", trips: [] }, ref);
    expect(e).toMatchObject({ nextServiceableDate: "2026-10-05", daysUnserved: 3, consecutiveDeferrals: 2 });
  });
});

// ---- Properties -----------------------------------------------------------------------------------------------------

const peliOutlets = [...ref.outlets.values()]
  .filter((o) => o.depot === "Peliyagoda")
  .sort((a, b) => (a.id < b.id ? -1 : 1));

/** A random small day: up to `maxOrders` orders and a fleet cut down to `vehicles` Peliyagoda vehicles. */
const smallDay = (maxOrders: number, vehicles: number) =>
  fc
    .record({ seed: fc.integer({ min: 1, max: 1_000_000 }), n: fc.integer({ min: 1, max: maxOrders }) })
    .map(({ seed, n }) => {
      const rnd = prng(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
      const fleet = [...ref.vehicles.values()].filter((v) => v.depot === "Peliyagoda").sort(() => 0);
      const chosen = new Set<string>();
      while (chosen.size < vehicles) chosen.add(pick(fleet).id);
      const orders: AllocationOrder[] = [];
      for (let i = 0; i < n; i++) {
        const outlet = pick(peliOutlets);
        orders.push(
          ao(`Q${i}`, outlet.id, {
            temp: outlet.brand === "Fresh" && rnd() < 0.5 ? "chilled" : "ambient",
            weightG: Math.round(100 + rnd() * 2500) * 1000,
            volumeL: Math.round(500 + rnd() * 14_000),
            deferredYesterday: rnd() < 0.2,
            daysSinceLastServed: 1 + Math.floor(rnd() * 10),
            deferredCount: rnd() < 0.15 ? 2 : 0,
          }),
        );
      }
      const input: AllocationInput = {
        date: DATE,
        depot: "Peliyagoda",
        orders,
        unavailableVehicleIds: new Set([...ref.vehicles.keys()].filter((id) => !chosen.has(id))),
      };
      return input;
    });

/**
 * Brute force: every assignment of orders to (vehicle, trip 1 or 2) or deferral, keeping the valid ones, and the served
 * set that is best under the lexicographic policy (serve rank 0 if any arrangement allows it, then rank 1, ...).
 */
function bruteForceServed(input: AllocationInput): string[] {
  const ranked = rankOrders(input.orders, DEFAULT_RULES_CONFIG, { date: input.date, calendar });
  const vehicles = [...ref.vehicles.values()].filter(
    (v) => v.depot === input.depot && !input.unavailableVehicleIds?.has(v.id),
  );
  const slots = vehicles.flatMap((v) => [1, 2].map((tripNo) => ({ vehicleId: v.id, tripNo })));
  const options = slots.length + 1;
  let best: boolean[] | null = null;
  const total = options ** ranked.length;
  for (let code = 0; code < total; code++) {
    let c = code;
    const trips = new Map<string, PlanTrip>();
    const served: boolean[] = [];
    for (const r of ranked) {
      const choice = c % options;
      c = Math.floor(c / options);
      served.push(choice > 0);
      if (choice === 0) continue;
      const slot = slots[choice - 1];
      if (!slot) continue;
      const key = `${slot.vehicleId}#${slot.tripNo}`;
      const t = trips.get(key) ?? { ref: key, vehicleId: slot.vehicleId, tripNo: slot.tripNo, orders: [] };
      trips.set(key, { ...t, orders: [...t.orders, r.order] });
    }
    // Trip 2 without trip 1 is the same as trip 1: skip it to keep the search honest and small.
    if ([...trips.values()].some((t) => t.tripNo === 2 && !trips.has(`${t.vehicleId}#1`))) continue;
    if (best && !lexBetter(served, best)) continue;
    const r = validatePlan({ date: input.date, trips: [...trips.values()] }, ref, {
      unavailableVehicleIds: input.unavailableVehicleIds,
    });
    if (!r.violations.some((v) => v.severity === "HARD")) best = served;
  }
  return ranked
    .filter((_, i) => best?.[i])
    .map((r) => r.order.id)
    .sort();
}

function lexBetter(a: readonly boolean[], b: readonly boolean[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return Boolean(a[i]);
  return false;
}

const servedIds = (r: AllocationResult) => r.trips.flatMap((t) => t.orders.map((o) => o.id)).sort();

describe("properties", () => {
  it("the output always passes validatePlan", () => {
    fc.assert(
      fc.property(smallDay(14, 4), (input) => {
        const r = proposePlan(input, ref);
        expect(validates(input, r).violations.filter((v) => v.severity === "HARD")).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic, also when the input order changes", () => {
    fc.assert(
      fc.property(smallDay(10, 3), (input) => {
        expect(proposePlan({ ...input, orders: [...input.orders].reverse() }, ref)).toEqual(proposePlan(input, ref));
      }),
      { numRuns: 40 },
    );
  });

  it("is single-insertion maximal: no deferred order fits the final plan", () => {
    fc.assert(
      fc.property(smallDay(12, 3), (input) => {
        const r = proposePlan(input, ref);
        const byId = new Map(input.orders.map((o) => [o.id, o]));
        for (const d of r.deferrals)
          expect(insertable(byId.get(d.orderId) as AllocationOrder, r.trips, input)).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  // Tiny = up to 4 orders on up to 3 vehicles (0 mismatches in a 3,000-instance sweep). The allocator is a bounded
  // local search, not an exact solver: at 5 orders on 2 vehicles a sweep found 1 mismatch in 3,000.
  it("agrees with brute force on tiny instances (lexicographic priority)", () => {
    fc.assert(
      fc.property(smallDay(4, 3), (input) => {
        expect(servedIds(proposePlan(input, ref))).toEqual(bruteForceServed(input));
      }),
      { numRuns: 150 },
    );
  });
});
