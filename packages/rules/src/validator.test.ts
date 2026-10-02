import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveRulesConfig } from "./config";
import type { PlanOrder, PlanTrip } from "./plan";
import { computeTripTime } from "./trip-time";
import { order, trip } from "./test-support/orders";
import { loadReferenceData } from "./test-support/reference-csv";
import type { Plan, ValidationContext, Violation, ViolationCode } from "./validator";
import { HARD_CODES, validatePlan, validateTrip, WARN_CODES } from "./validator";

const ref = loadReferenceData();
const DATE = "2026-10-06"; // Tuesday, after calendar.csv ends: operating by the Mon-Sat fallback (ADR 0018).

const o = (id: string, outletId: string, extra: Partial<PlanOrder> = {}) =>
  order(id, outletId, { deliveryDate: DATE, ...extra });

function check(trips: PlanTrip[], ctx: ValidationContext = {}, extra: Partial<Plan> = {}) {
  return validatePlan({ date: DATE, trips, ...extra }, ref, ctx);
}

function only(violations: readonly Violation[], code: ViolationCode): Violation[] {
  return violations.filter((v) => v.code === code);
}

function codes(violations: readonly Violation[]): ViolationCode[] {
  return [...new Set(violations.map((v) => v.code))].sort();
}

// The Booklet's double-Fresh example on VEH001 (reefer truck): 101 + 112 = 213 of 270.
const gampaha = trip("T1", "VEH001", 1, [o("G1", "OUT026"), o("G2", "OUT030"), o("G3", "OUT028")]);
const colombo = trip("T2", "VEH001", 2, [o("C1", "OUT004"), o("C2", "OUT006"), o("C3", "OUT007"), o("C4", "OUT014")]);

describe("a valid plan", () => {
  it("passes with no violations", () => {
    const r = check([gampaha, colombo]);
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("shapes each violation with code, severity, location, orders, params and message key", () => {
    const heavy = trip("T9", "VEH008", 1, [o("H", "OUT026", { weightG: 3_900_000 })]);
    const [v] = only(check([heavy]).violations, "WEIGHT_CAP_EXCEEDED");
    expect(v).toEqual({
      code: "WEIGHT_CAP_EXCEEDED",
      severity: "HARD",
      tripRef: "T9",
      vehicleId: "VEH008",
      orderIds: ["H"],
      params: { limit: 3_800_000, actual: 3_900_000 },
      message_key: "validator.WEIGHT_CAP_EXCEEDED",
    });
  });
});

describe("HARD codes, one test each", () => {
  it("WEIGHT_CAP_EXCEEDED", () => {
    const t = trip("T", "VEH008", 1, [
      o("A", "OUT026", { weightG: 2_000_000 }),
      o("B", "OUT030", { weightG: 1_900_000 }),
    ]);
    expect(only(check([t]).violations, "WEIGHT_CAP_EXCEEDED")[0]?.params).toEqual({
      limit: 3_800_000,
      actual: 3_900_000,
    });
  });

  it("VOLUME_CAP_EXCEEDED", () => {
    const t = trip("T", "VEH008", 1, [o("A", "OUT026", { volumeL: 22_001 })]);
    expect(only(check([t]).violations, "VOLUME_CAP_EXCEEDED")[0]?.params).toEqual({ limit: 22_000, actual: 22_001 });
  });

  it("REEFER_REQUIRED", () => {
    const t = trip("T", "VEH008", 1, [o("A", "OUT026", { temp: "chilled" })]);
    expect(only(check([t]).violations, "REEFER_REQUIRED")[0]?.orderIds).toEqual(["A"]);
    expect(
      only(check([trip("T", "VEH001", 1, [o("A", "OUT026", { temp: "chilled" })])]).violations, "REEFER_REQUIRED"),
    ).toEqual([]);
  });

  it("VAN_REQUIRED", () => {
    expect(only(check([trip("T", "VEH008", 1, [o("A", "OUT001")])]).violations, "VAN_REQUIRED")).toHaveLength(1);
    expect(only(check([trip("T", "VEH035", 1, [o("A", "OUT001")])]).violations, "VAN_REQUIRED")).toEqual([]);
  });

  it("DEPOT_MISMATCH", () => {
    const [v] = only(check([trip("T", "VEH008", 1, [o("A", "OUT084")])]).violations, "DEPOT_MISMATCH");
    expect(v?.params).toEqual({ vehicleDepot: "Peliyagoda", outletDepot: "Kandy" });
  });

  it("MIXED_BRAND", () => {
    const t = trip("T", "VEH008", 1, [o("A", "OUT019"), o("B", "OUT023")]);
    expect(only(check([t]).violations, "MIXED_BRAND")[0]).toMatchObject({
      orderIds: ["B"],
      params: { tripBrand: "Style" },
    });
  });

  it("MIXED_DISTRICT", () => {
    const t = trip("T", "VEH008", 1, [o("A", "OUT026"), o("B", "OUT004")]);
    expect(only(check([t]).violations, "MIXED_DISTRICT")[0]).toMatchObject({
      orderIds: ["B"],
      params: { tripDistrict: "Gampaha" },
    });
  });

  it("ORDER_SPLIT", () => {
    const a = o("A", "OUT026");
    const r = check([trip("T1", "VEH008", 1, [a]), trip("T2", "VEH009", 1, [a])]);
    expect(only(r.violations, "ORDER_SPLIT")[0]).toMatchObject({ orderIds: ["A"], params: { trips: "T1,T2" } });
  });

  it("ORDER_UNASSIGNED_UNKNOWN: an order not in the day's orders, or an unknown outlet", () => {
    const known = [o("A", "OUT026")];
    const r = check(
      [trip("T", "VEH008", 1, [o("A", "OUT026"), o("Z", "OUT030"), o("Y", "OUT999")])],
      {},
      { orders: known },
    );
    expect(only(r.violations, "ORDER_UNASSIGNED_UNKNOWN").map((v) => [v.orderIds[0], v.params.reason])).toEqual([
      ["Z", "UNKNOWN_ORDER"],
      ["Y", "UNKNOWN_OUTLET"],
    ]);
  });

  it("does not flag orders left unassigned (publish requires their reasons separately)", () => {
    const r = check([gampaha], {}, { orders: [...gampaha.orders, o("U", "OUT004")] });
    expect(r.ok).toBe(true);
  });

  it("TRIP_LIMIT_EXCEEDED: a third trip, a trip number out of range, or a repeated trip number", () => {
    const t = (ref: string, n: number) => trip(ref, "VEH008", n, [o(`${ref}o`, "OUT026")]);
    expect(only(check([t("A", 1), t("B", 2), t("C", 2)]).violations, "TRIP_LIMIT_EXCEEDED")[0]?.params).toMatchObject({
      limit: 2,
      actual: 3,
    });
    expect(only(check([t("A", 3)]).violations, "TRIP_LIMIT_EXCEEDED")).toHaveLength(1);
    expect(only(check([t("A", 1), t("B", 1)]).violations, "TRIP_LIMIT_EXCEEDED")).toHaveLength(1);
  });

  it("TIME_BUDGET_EXCEEDED: Matara 177 + Gampaha 101 = 278 of 270 Fresh minutes", () => {
    const matara = trip("M", "VEH001", 1, [o("M1", "OUT060"), o("M2", "OUT062")]);
    expect(computeTripTime(matara, ref).totalMin).toBe(177);
    const r = check([matara, { ...gampaha, tripNo: 2 }]);
    expect(only(r.violations, "TIME_BUDGET_EXCEEDED")[0]).toMatchObject({
      vehicleId: "VEH001",
      params: { limit: 270, actual: 278, budgetClass: "FRESH" },
    });
    expect(only(r.violations, "WINDOW_MISSED")).toEqual([]);
  });

  it("counts Fresh and Style/Tech budgets separately", () => {
    const style = trip("S", "VEH001", 2, [o("S1", "OUT019")]);
    expect(only(check([gampaha, style]).violations, "TIME_BUDGET_EXCEEDED")).toEqual([]);
  });

  it("WINDOW_MISSED from the validation ETA", () => {
    const matara = trip("M", "VEH001", 1, [o("M1", "OUT060"), o("M2", "OUT062")]);
    const late = trip("C", "VEH001", 2, [o("C1", "OUT008"), o("C2", "OUT010"), o("C3", "OUT013")]);
    const [v] = only(check([matara, late]).violations, "WINDOW_MISSED");
    // Departs 03:30 + 177 = 06:27; stops at 06:51, 07:14, 07:37 against a 07:30 close.
    expect(v).toMatchObject({ tripRef: "C", orderIds: ["C3"], params: { limit: 450, actual: 457 } });
  });

  it("MALL_WINDOW_VIOLATION when a mall stop is reached after the mall closes", () => {
    const kurunegala = trip("K", "VEH008", 1, [o("K1", "OUT070"), o("K2", "OUT071")]);
    const mall = trip("M", "VEH008", 2, [o("M1", "OUT017"), o("M2", "OUT018")]);
    const r = check([kurunegala, mall]);
    expect(only(r.violations, "MALL_WINDOW_VIOLATION").map((v) => v.orderIds[0])).toEqual(["M2"]);
    expect(only(r.violations, "WINDOW_MISSED")).toEqual([]);
  });

  it("NON_OPERATING_DAY", () => {
    const r = validatePlan(
      {
        date: "2026-10-04",
        trips: [{ ...gampaha, orders: gampaha.orders.map((x) => ({ ...x, deliveryDate: "2026-10-04" })) }],
      },
      ref,
    );
    expect(only(r.violations, "NON_OPERATING_DAY")[0]?.params).toEqual({ date: "2026-10-04" });
  });

  it("FUEL_QUOTA_EXCEEDED with the date in params (ADR 0006)", () => {
    const r = check([gampaha], { fuelUsedThisWeekMl: new Map([["VEH001", 330_000]]) });
    expect(only(r.violations, "FUEL_QUOTA_EXCEEDED")[0]).toMatchObject({
      vehicleId: "VEH001",
      params: { limit: 340_000, actual: 344_894, date: DATE },
    });
  });

  it("VEHICLE_UNAVAILABLE for a workshop vehicle or an unknown one", () => {
    const r = check([gampaha], { unavailableVehicleIds: new Set(["VEH001"]) });
    expect(only(r.violations, "VEHICLE_UNAVAILABLE")[0]?.params).toEqual({ reason: "IN_WORKSHOP", date: DATE });
    expect(only(check([{ ...gampaha, vehicleId: "VEH999" }]).violations, "VEHICLE_UNAVAILABLE")[0]?.params).toEqual({
      reason: "UNKNOWN_VEHICLE",
    });
  });

  it("ORDER_NOT_CONFIRMED for another date or a status that cannot be planned", () => {
    const t = trip("T", "VEH008", 1, [
      o("A", "OUT026", { deliveryDate: "2026-10-07" }),
      o("B", "OUT030", { status: "CANCELLED" }),
      o("C", "OUT028"),
    ]);
    expect(only(check([t]).violations, "ORDER_NOT_CONFIRMED").map((v) => v.orderIds[0])).toEqual(["A", "B"]);
  });

  it("ORDER_ALREADY_LOADED when a loaded order is moved or removed without a reversal request (ADR 0004)", () => {
    const pins = new Map([
      ["G1", { vehicleId: "VEH001", tripNo: 1, reversalRequested: false }],
      ["C9", { vehicleId: "VEH001", tripNo: 2, reversalRequested: false }],
      ["C1", { vehicleId: "VEH002", tripNo: 1, reversalRequested: false }],
      ["C2", { vehicleId: "VEH002", tripNo: 1, reversalRequested: true }],
    ]);
    const r = check([gampaha, colombo], { loadedOrders: pins });
    expect(only(r.violations, "ORDER_ALREADY_LOADED").map((v) => [v.orderIds[0], v.params.change])).toEqual([
      ["C9", "REMOVED"],
      ["C1", "MOVED"],
    ]);
  });
});

describe("WARN codes, one test each", () => {
  it("LATE_RISK when only the display ETA misses a window (ADR 0003)", () => {
    const kalutara = trip("K", "VEH035", 1, [o("K1", "OUT040"), o("K2", "OUT041"), o("K3", "OUT042")]);
    const second = trip("C", "VEH035", 2, [o("C0", "OUT001")]);
    const r = check([kalutara, second]);
    expect(only(r.violations, "LATE_RISK")[0]).toMatchObject({ severity: "WARN", tripRef: "C", orderIds: ["C0"] });
    expect(only(r.violations, "WINDOW_MISSED")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("LATE_RISK becomes WINDOW_MISSED when validationEtaIncludesReturn is set", () => {
    const kalutara = trip("K", "VEH035", 1, [o("K1", "OUT040"), o("K2", "OUT041"), o("K3", "OUT042")]);
    const second = trip("C", "VEH035", 2, [o("C0", "OUT001")]);
    const r = check([kalutara, second], { cfg: resolveRulesConfig({ validationEtaIncludesReturn: true }) });
    expect(codes(r.violations)).toContain("WINDOW_MISSED");
    expect(r.ok).toBe(false);
  });

  it("REPEAT_DEFERRAL for an outlet deferred on the last run, noting whether a note was given", () => {
    const orders = [o("A", "OUT026"), o("B", "OUT030")];
    const r = check(
      [],
      { deferredLastRunOutletIds: new Set(["OUT026"]) },
      {
        orders,
        deferrals: [
          { orderId: "A", reasonCode: "TIME_BUDGET" },
          { orderId: "B", reasonCode: "TIME_BUDGET" },
        ],
      },
    );
    expect(only(r.violations, "REPEAT_DEFERRAL")).toEqual([
      expect.objectContaining({
        severity: "WARN",
        orderIds: ["A"],
        params: { outletId: "OUT026", noteProvided: false },
      }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("LOW_FUEL_MARGIN when under 10 % of the weekly quota is left", () => {
    const r = check([gampaha], { fuelUsedThisWeekMl: new Map([["VEH001", 320_000]]) });
    expect(only(r.violations, "LOW_FUEL_MARGIN")[0]).toMatchObject({
      severity: "WARN",
      params: { limit: 340_000, actual: 334_894 },
    });
    expect(r.ok).toBe(true);
  });

  it("every listed code is implemented", () => {
    expect([...HARD_CODES, ...WARN_CODES]).toHaveLength(21);
  });
});

describe("validateTrip", () => {
  it("checks a trip against its vehicle's other trips and reports only what concerns it", () => {
    const matara = trip("M", "VEH001", 1, [o("M1", "OUT060"), o("M2", "OUT062")]);
    const other = trip("X", "VEH008", 1, [o("X1", "OUT026", { weightG: 9_000_000 })]);
    const r = validateTrip({ ...gampaha, tripNo: 2 }, ref, { date: DATE, siblingTrips: [matara, other] });
    // Trip 2 after Matara: over the Fresh budget, and the display ETA (after return and reload) runs late.
    expect(codes(r.violations)).toEqual(["LATE_RISK", "TIME_BUDGET_EXCEEDED"]);
    expect(r.violations.every((v) => v.vehicleId === "VEH001")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("passes a valid trip", () => {
    expect(validateTrip(gampaha, ref, { date: DATE }).ok).toBe(true);
  });
});

// ---- Properties -----------------------------------------------------------------------------------------------------

const peliyagoda = [...ref.vehicles.values()].filter((v) => v.depot === "Peliyagoda");
const wideOutlets = [...ref.outlets.values()].filter(
  (x) =>
    x.depot === "Peliyagoda" &&
    x.mallWindow === null &&
    ((x.brand === "Fresh" && x.window.open === 180 && x.window.close === 480) ||
      (x.brand !== "Fresh" && x.window.open === 540 && x.window.close === 1020)),
);
const allPeliyagodaOutlets = [...ref.outlets.values()].filter((x) => x.depot === "Peliyagoda");

const rawTrip = (outlets: typeof wideOutlets) =>
  fc.record({
    brand: fc.constantFrom("Fresh", "Style", "Tech"),
    seed: fc.nat(),
    picks: fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
    chilled: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    sizes: fc.array(fc.record({ kg: fc.integer({ min: 20, max: 1500 }), m3: fc.integer({ min: 1, max: 60 }) }), {
      minLength: 6,
      maxLength: 6,
    }),
    outlets: fc.constant(outlets),
  });

/** Random plans built from the Booklet's seven feasibility rules (wide-window, non-mall outlets). */
const booklet = fc
  .array(
    fc.record({
      vehicle: fc.constantFrom(...peliyagoda),
      trips: fc.array(rawTrip(wideOutlets), { minLength: 1, maxLength: 2 }),
    }),
    {
      minLength: 1,
      maxLength: 8,
    },
  )
  .map((runs) => {
    const trips: PlanTrip[] = [];
    const used = new Set<string>();
    let n = 0;
    for (const run of runs) {
      const v = run.vehicle;
      if (used.has(v.id)) continue;
      used.add(v.id);
      let vehicleTrips: PlanTrip[] = [];
      for (const raw of run.trips) {
        const candidates = raw.outlets.filter(
          (x) => x.brand === raw.brand && (x.parking !== "van_only" || v.type === "van"),
        );
        const districts = [...new Set(candidates.map((x) => x.district))].sort();
        const district = districts[raw.seed % Math.max(1, districts.length)];
        const pool = candidates.filter((x) => x.district === district);
        if (!pool.length) continue;
        const orders: PlanOrder[] = [];
        let kg = 0;
        let m3 = 0;
        raw.picks.forEach((p, i) => {
          const size = raw.sizes[i] ?? { kg: 20, m3: 1 };
          const outlet = pool[p % pool.length];
          if (!outlet) return;
          const weightG = size.kg * 1000;
          const volumeL = size.m3 * 100;
          if (kg + weightG > v.weightCapG || m3 + volumeL > v.volumeCapL) return; // rule 6: capacity
          kg += weightG;
          m3 += volumeL;
          const temp = raw.brand === "Fresh" && v.temp === "reefer" && raw.chilled[i] ? "chilled" : "ambient"; // rule 2
          orders.push(o(`O${n++}`, outlet.id, { weightG, volumeL, temp }));
        });
        if (orders.length) vehicleTrips.push(trip(`T${n++}`, v.id, 0, orders));
      }
      // Rule 7: Fresh trips first, then trim the last orders until each class budget holds.
      vehicleTrips.sort((a, b) => Number(isStyle(a)) - Number(isStyle(b)));
      for (const cls of [false, true]) {
        const budget = cls ? 480 : 270;
        const total = () =>
          vehicleTrips.filter((t) => isStyle(t) === cls).reduce((s, t) => s + computeTripTime(t, ref).totalMin, 0);
        while (total() > budget) {
          const last = [...vehicleTrips].reverse().find((t) => isStyle(t) === cls && t.orders.length);
          if (!last) break;
          vehicleTrips = vehicleTrips.map((t) => (t === last ? { ...t, orders: t.orders.slice(0, -1) } : t));
        }
      }
      vehicleTrips = vehicleTrips.filter((t) => t.orders.length).map((t, i) => ({ ...t, tripNo: i + 1 }));
      trips.push(...vehicleTrips);
    }
    return trips;
  });

function isStyle(t: PlanTrip): boolean {
  const first = t.orders[0];
  return first ? ref.outlets.get(first.outletId)?.brand !== "Fresh" : false;
}

/** Arbitrary plans on any outlets, windows and malls included, rules not enforced. */
const anyPlan = fc
  .array(
    fc.record({
      vehicle: fc.constantFrom(...peliyagoda),
      trips: fc.array(rawTrip(allPeliyagodaOutlets), { minLength: 1, maxLength: 2 }),
    }),
    {
      minLength: 1,
      maxLength: 6,
    },
  )
  .map((runs) => {
    let n = 0;
    return runs.flatMap((run, r) =>
      run.trips.map((raw, i) => {
        const pool = raw.outlets.filter((x) => x.brand === raw.brand);
        return trip(
          `A${r}-${i}`,
          run.vehicle.id,
          i + 1,
          raw.picks.map((p) => o(`P${n++}`, pool[(p + raw.seed) % pool.length]?.id ?? "OUT026")),
        );
      }),
    );
  });

const hard = (trips: PlanTrip[], ctx: ValidationContext = {}) =>
  validatePlan({ date: DATE, trips }, ref, ctx)
    .violations.filter((v) => v.severity === "HARD")
    .map((v) => `${v.code}:${v.tripRef ?? ""}:${v.vehicleId ?? ""}:${v.orderIds.join(",")}`)
    .sort();

describe("properties (ADR 0003)", () => {
  it("a plan the Booklet's formula accepts never yields a HARD violation", () => {
    fc.assert(
      fc.property(booklet, (trips) => {
        expect(hard(trips)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("display-only settings (return leg, reload buffer) never change the HARD result", () => {
    const slow = resolveRulesConfig({ reloadBufferMin: 240 });
    fc.assert(
      fc.property(anyPlan, (trips) => {
        expect(hard(trips, { cfg: slow })).toEqual(hard(trips));
      }),
      { numRuns: 200 },
    );
  });
});

describe("performance", () => {
  it("validates a peak-day-sized plan (about 86 orders) in under 50 ms", () => {
    const fresh = wideOutlets.filter((x) => x.brand === "Fresh");
    const trips: PlanTrip[] = [];
    let k = 0;
    for (const v of peliyagoda.slice(0, 22)) {
      const district = fresh[k % fresh.length]?.district;
      const pool = fresh.filter((x) => x.district === district && (x.parking !== "van_only" || v.type === "van"));
      trips.push(
        trip(
          `T${k}`,
          v.id,
          1,
          [0, 1, 2, 3].map((i) => o(`O${k}-${i}`, pool[i % Math.max(1, pool.length)]?.id ?? "OUT026")),
        ),
      );
      k++;
    }
    const orders = trips.flatMap((t) => t.orders);
    expect(orders.length).toBeGreaterThanOrEqual(86);
    validatePlan({ date: DATE, trips, orders }, ref); // warm up
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i++) validatePlan({ date: DATE, trips, orders }, ref);
    const perPlan = (performance.now() - start) / runs;
    expect(perPlan).toBeLessThan(50);
  });
});
