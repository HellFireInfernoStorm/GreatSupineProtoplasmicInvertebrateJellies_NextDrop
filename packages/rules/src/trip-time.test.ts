import { describe, expect, it } from "vitest";
import { DEFAULT_RULES_CONFIG, resolveRulesConfig } from "./config";
import { computeEtas, computeRunSchedule, etaBand, sequenceStops } from "./etas";
import { computeFuel } from "./fuel";
import { computeTripTime } from "./trip-time";
import { formatClock } from "./units";
import { order, trip } from "./test-support/orders";
import { loadReferenceData } from "./test-support/reference-csv";

const ref = loadReferenceData();

// Booklet, "Calculate trip time": a Fresh trip to Gampaha with two rear-dock stops and one street stop...
const gampaha = trip("T1", "VEH014", 1, [order("G1", "OUT026"), order("G2", "OUT030"), order("G3", "OUT028")]);
// ...and a second Fresh trip to Colombo with four street-access stops.
const colombo = trip("T2", "VEH014", 2, [
  order("C1", "OUT004"),
  order("C2", "OUT006"),
  order("C3", "OUT007"),
  order("C4", "OUT014"),
]);

describe("computeTripTime: the Booklet's worked examples", () => {
  it("uses real outlets of the right dock types", () => {
    expect(["OUT026", "OUT030", "OUT028"].map((id) => ref.outlets.get(id)?.dockType)).toEqual([
      "rear_dock",
      "rear_dock",
      "street",
    ]);
    expect(["OUT004", "OUT006", "OUT007", "OUT014"].every((id) => ref.outlets.get(id)?.dockType === "street")).toBe(
      true,
    );
  });

  it("Gampaha Fresh, 3 stops: 37 + 9 × 2 + 15 + 15 + 16 = 101 minutes", () => {
    expect(computeTripTime(gampaha, ref)).toMatchObject({
      brand: "Fresh",
      district: "Gampaha",
      budgetClass: "FRESH",
      outboundMin: 37,
      interStopMin: 18,
      handlingMin: 46,
      totalMin: 101,
    });
  });

  it("Colombo Fresh, 4 street stops: 24 + 3 × 8 + 4 × 16 = 112 minutes", () => {
    expect(computeTripTime(colombo, ref)).toMatchObject({
      outboundMin: 24,
      interStopMin: 24,
      handlingMin: 64,
      totalMin: 112,
    });
  });

  it("both trips use 101 + 112 = 213 of the vehicle's 270 Fresh minutes", () => {
    const used = computeTripTime(gampaha, ref).totalMin + computeTripTime(colombo, ref).totalMin;
    expect(used).toBe(213);
    expect(used).toBeLessThanOrEqual(DEFAULT_RULES_CONFIG.freshBudgetMin);
  });

  it("has no inter-stop time for a single stop and zero for an empty trip", () => {
    expect(computeTripTime(trip("T", "VEH014", 1, [order("A", "OUT026")]), ref)).toMatchObject({
      interStopMin: 0,
      totalMin: 52,
    });
    expect(computeTripTime(trip("T", "VEH014", 1, []), ref).totalMin).toBe(0);
  });

  it("charges handling by the trip's brand and each outlet's dock type", () => {
    const style = [...ref.outlets.values()].filter((o) => o.brand === "Style" && o.dockType === "mall_bay").slice(0, 1);
    const t = trip(
      "S",
      "VEH020",
      1,
      style.map((o, i) => order(`S${i}`, o.id)),
    );
    expect(computeTripTime(t, ref)).toMatchObject({ budgetClass: "STYLE_TECH", handlingMin: 59 });
  });
});

describe("validity inputs", () => {
  it("reads only outlets, districts and service allowances: traffic and road conditions cannot affect trip time", () => {
    const allowed = new Set(["outlets", "districts", "serviceAllowances"]);
    const guarded = new Proxy(ref, {
      get(target, key, receiver) {
        if (typeof key === "string" && !allowed.has(key)) throw new Error(`computeTripTime read ref.${key}`);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(computeTripTime(gampaha, guarded).totalMin).toBe(101);
  });
});

describe("stop sequence", () => {
  it("orders by earliest window close, then district, then order id", () => {
    // OUT027 closes 07:30, OUT026 and OUT028 close 08:00 (tie broken by order id).
    const t = trip("T", "V", 1, [order("Z", "OUT026"), order("Y", "OUT028"), order("X", "OUT027")]);
    expect(sequenceStops(t, ref).map((o) => o.id)).toEqual(["X", "Y", "Z"]);
  });
});

describe("ETAs (ADR 0003)", () => {
  const run = computeRunSchedule([colombo, gampaha], ref);
  const [t1, t2] = run;

  it("schedules trips in trip-number order, Fresh trip 1 departing at 03:30", () => {
    expect(run.map((s) => s.trip.ref)).toEqual(["T1", "T2"]);
    expect(formatClock(t1?.departure.validation ?? -1)).toBe("03:30");
    expect(t1?.departure.display).toBe(t1?.departure.validation);
  });

  it("waits at a stop until its window opens", () => {
    // Gampaha first stop: OUT028 opens 03:00, reached 04:07; OUT026 / OUT030 open 03:00 too, so no waiting here.
    expect(t1?.stops.map((s) => formatClock(s.validation.start))).toEqual(["04:07", "04:31", "04:55"]);
    const late = computeRunSchedule([trip("W", "V", 1, [order("W1", "OUT025")])], ref)[0];
    // OUT025 opens 05:30: reached at 04:07, waits 83 minutes.
    expect(late?.stops[0]).toMatchObject({ validation: { arrival: 247, start: 330, wait: 83 } });
  });

  it("starts trip 2's validation ETA when trip 1's trip_minutes have elapsed (no return, no reload)", () => {
    expect(formatClock(t2?.departure.validation ?? -1)).toBe("05:11"); // 03:30 + 101
  });

  it("starts trip 2's display ETA after trip 1 ends, returns and reloads", () => {
    // Trip 1 leaves its last stop at 05:11, drives back 37 minutes and reloads 15: 06:03.
    expect(formatClock(t1?.end.display ?? -1)).toBe("05:11");
    expect(formatClock(t2?.departure.display ?? -1)).toBe("06:03");
  });

  it("raises a display-only miss, never a validation miss, for a plan the Booklet accepts", () => {
    expect(t2?.stops.every((s) => s.onTimeValidation)).toBe(true);
    const displayMisses = t2?.stops.filter((s) => !s.onTimeDisplay).map((s) => s.outletId);
    // Display: 06:03 + 24 = 06:27, then 06:51, 07:15, 07:39: all before 08:00.
    expect(displayMisses).toEqual([]);
  });

  it("uses the display model for validation when validationEtaIncludesReturn is set", () => {
    const cfg = resolveRulesConfig({ validationEtaIncludesReturn: true });
    const strict = computeRunSchedule([gampaha, colombo], ref, cfg);
    expect(strict[1]?.departure.validation).toBe(strict[1]?.departure.display);
  });

  it("detects a window the display ETA misses while the validation ETA meets it", () => {
    // Colombo trip 2 with an extra 07:30-close outlet as its first stop and a long Kalutara trip 1.
    const kalutaraOutlets = [...ref.outlets.values()]
      .filter((o) => o.district === "Kalutara" && o.brand === "Fresh")
      .slice(0, 3);
    const long = trip(
      "K",
      "V9",
      1,
      kalutaraOutlets.map((o, i) => order(`K${i}`, o.id)),
    );
    const second = trip("C", "V9", 2, [order("C0", "OUT001"), order("C1b", "OUT004")]);
    const [, s2] = computeRunSchedule([long, second], ref);
    const first = s2?.stops[0];
    expect(first?.outletId).toBe("OUT001");
    expect(first?.onTimeValidation).toBe(true);
    expect(first?.onTimeDisplay).toBe(false);
  });

  it("departs a Style/Tech trip no earlier than the trading day and not before its first stop opens", () => {
    const styleOutlets = [...ref.outlets.values()].filter((o) => o.brand === "Style" && o.parking === "mall_dock");
    const mall = styleOutlets.find((o) => o.mallWindow?.open === 630);
    expect(mall).toBeDefined();
    const s = computeRunSchedule([trip("S1", "V", 1, [order("S", mall?.id ?? "")])], ref)[0];
    const outbound = ref.districts.get(mall?.district ?? "")?.depotToDistrictMin ?? 0;
    expect(s?.departure.validation).toBe(Math.max(480, 630 - outbound));
    expect(s?.stops[0]?.validation.start).toBe(630);
    expect(s?.stops[0]?.window).toEqual({ open: 630, close: 750 });
  });

  it("computeEtas takes the vehicle's earlier trips into account", () => {
    const etas = computeEtas(colombo, ref, { previousTrips: [gampaha] });
    expect(formatClock(etas[0]?.validation.start ?? -1)).toBe("05:35"); // 05:11 + 24
    expect(etas.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it("has no window when the outlet and mall windows do not overlap", () => {
    const fake = new Map(ref.outlets);
    const base = ref.outlets.get("OUT026");
    if (!base) throw new Error("fixture");
    fake.set("X", { ...base, id: "X", parking: "mall_dock", mallWindow: { open: 600, close: 660 } });
    const [s] = computeRunSchedule([trip("T", "V", 1, [order("x", "X")])], { ...ref, outlets: fake });
    expect(s?.stops[0]).toMatchObject({ window: null, onTimeValidation: false, onTimeDisplay: false });
  });
});

describe("store ETA band", () => {
  it("is ETA_WINDOW_MIN wide, centred on the ETA, starting on a 5-minute mark", () => {
    expect(etaBand(6 * 60 + 27)).toEqual({ open: 6 * 60 + 10, close: 6 * 60 + 40 });
    expect(etaBand(6 * 60, { etaWindowMin: 60 })).toEqual({ open: 5 * 60 + 30, close: 6 * 60 + 30 });
  });
});

describe("computeFuel", () => {
  const veh = ref.vehicles.get("VEH001");
  if (!veh) throw new Error("fixture");

  it("counts the return leg by default (FUEL_INCLUDE_RETURN)", () => {
    // Gampaha: 28 km × 2 + 7 km × 2 = 70 km; VEH001 does 4.7 km/L -> 14.894 L, rounded up to the millilitre.
    expect(computeFuel(gampaha, veh, ref)).toEqual({ metres: 70_000, millilitres: 14_894, km: 70, litres: 14.894 });
  });

  it("drops the return leg when configured", () => {
    expect(computeFuel(gampaha, veh, ref, { fuelIncludeReturn: false }).metres).toBe(42_000);
  });

  it("is zero for an empty trip", () => {
    expect(computeFuel(trip("E", "VEH001", 1, []), veh, ref).millilitres).toBe(0);
  });
});
