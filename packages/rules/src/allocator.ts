// The allocator (spec/rules-core/allocator.md) and deferral explanations (spec/rules-core/deferral-explanation.md).
//
// Pure and deterministic: the same input always gives the same plan, whatever the input order. Every placement is
// checked with validatePlan on the vehicle's day, so the output always passes the validator, and the first failing
// rule of the best placement is the binding constraint of a deferral.
import type { LocalDate } from "./calendar";
import { daysBetween, operatingDateAfter } from "./calendar";
import type { RulesConfig } from "./config";
import { DEFAULT_RULES_CONFIG } from "./config";
import { sequenceStops } from "./etas";
import type { BudgetClass, PlanOrder, PlanTrip } from "./plan";
import { budgetClassOf } from "./plan";
import type { AllocationOrder, RankedOrder, ScoreInputs } from "./ranking";
import { rankOrders, scoreInputsOf } from "./ranking";
import type { Outlet, ReferenceData, Vehicle } from "./reference";
import type { Millilitres } from "./units";
import type { Violation, ViolationCode } from "./validator";
import { validatePlan } from "./validator";

export const REASON_CODES = [
  "CAPACITY_WEIGHT",
  "CAPACITY_VOLUME",
  "REEFER_SHORTAGE",
  "VAN_SHORTAGE",
  "TIME_BUDGET",
  "FUEL_QUOTA",
  "WINDOW_INFEASIBLE",
  "VEHICLE_IN_WORKSHOP",
  "VEHICLE_BREAKDOWN",
  "MOVED_BY_POLICY",
  "OTHER",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const CAUSE_KINDS = ["UNAVOIDABLE_INFEASIBLE", "UNAVOIDABLE_POOL_EXHAUSTED", "CHOICE"] as const;
export type CauseKind = (typeof CAUSE_KINDS)[number];

export interface DeferralExplanation {
  readonly orderId: string;
  readonly reasonCode: ReasonCode;
  readonly causeKind: CauseKind;
  /** The first rule the best placement broke, or what made every vehicle ineligible. */
  readonly bindingConstraint: ViolationCode | "NO_ELIGIBLE_VEHICLE" | null;
  readonly scoreInputs: ScoreInputs | null;
  /** Higher-priority orders holding the resource this order needed (pool exhausted only). */
  readonly displacedBy: readonly string[];
  readonly note: string;
  /** Next operating date after the planning date (ADR 0010). */
  readonly nextServiceableDate: LocalDate;
  /** Calendar days from the requested date to `nextServiceableDate`. */
  readonly daysUnserved: number;
  readonly consecutiveDeferrals: number;
}

export interface AllocationInput {
  readonly date: LocalDate;
  readonly depot: string;
  /** Confirmed orders for the day. */
  readonly orders: readonly AllocationOrder[];
  /** Vehicles `IN_WORKSHOP` on the date. */
  readonly unavailableVehicleIds?: ReadonlySet<string>;
  /** The workshop vehicles whose reason is a breakdown (ADR 0017). */
  readonly breakdownVehicleIds?: ReadonlySet<string>;
  /** Fuel used this ISO week by each vehicle, excluding this day's published trips (ADR 0006). */
  readonly fuelUsedThisWeekMl?: ReadonlyMap<string, Millilitres>;
}

export interface AllocationStats {
  readonly orders: number;
  readonly served: number;
  readonly deferred: number;
  readonly demandVolumeL: Readonly<Record<BudgetClass, number>>;
  readonly servedVolumeL: Readonly<Record<BudgetClass, number>>;
  readonly vehiclesAvailable: number;
  readonly vehiclesUsed: number;
  readonly tripSlotsAvailable: number;
  readonly tripsUsed: number;
  readonly reefers: { readonly available: number; readonly used: number };
  readonly vans: { readonly available: number; readonly used: number };
  readonly localSearchMoves: number;
}

export interface AllocationResult {
  /** Trips in vehicle order, refs `T001`..., stops in delivery sequence. */
  readonly trips: readonly PlanTrip[];
  /** Deferrals in priority order. */
  readonly deferrals: readonly DeferralExplanation[];
  readonly stats: AllocationStats;
  /** Human-readable account of every decision. */
  readonly trace: readonly string[];
}

// ---- Shared placement machinery -------------------------------------------------------------------------------------

type Run = readonly (readonly PlanOrder[])[];

type Placement =
  /** `swap` runs the vehicle's two trips in the other order: trip order is free, and windows may need it. */
  | { readonly kind: "JOIN"; readonly vehicleId: string; readonly slot: number; readonly swap: boolean }
  | { readonly kind: "NEW"; readonly vehicleId: string; readonly first: boolean };

interface Env {
  readonly date: LocalDate;
  readonly ref: ReferenceData;
  readonly cfg: RulesConfig;
  /** Depot vehicles, sorted by id, including unavailable ones. */
  readonly fleet: readonly Vehicle[];
  readonly unavailable: ReadonlySet<string>;
  readonly breakdown: ReadonlySet<string>;
  readonly fuel: ReadonlyMap<string, Millilitres>;
}

function outletOrNull(order: PlanOrder, ref: ReferenceData): Outlet | null {
  return ref.outlets.get(order.outletId) ?? null;
}

function groupKey(outlet: Outlet): string {
  return `${outlet.brand}|${outlet.district}`;
}

/** Depot, temperature, access and single-order capacity: what makes a vehicle able to carry an order at all. */
function staticallyEligible(order: PlanOrder, outlet: Outlet, v: Vehicle): boolean {
  return (
    v.depot === outlet.depot &&
    (order.temp !== "chilled" || v.temp === "reefer") &&
    (outlet.parking !== "van_only" || v.type === "van") &&
    order.weightG <= v.weightCapG &&
    order.volumeL <= v.volumeCapL
  );
}

class Draft {
  readonly runs = new Map<string, Run>();
  private readonly cache = new Map<string, Violation | null>();

  constructor(private readonly env: Env) {}

  clone(): Draft {
    const d = new Draft(this.env);
    for (const [k, v] of this.runs) d.runs.set(k, v);
    return d;
  }

  tripsOf(vehicleId: string): Run {
    return this.runs.get(vehicleId) ?? [];
  }

  placed(): Set<string> {
    const s = new Set<string>();
    for (const run of this.runs.values()) for (const t of run) for (const o of t) s.add(o.id);
    return s;
  }

  /** The vehicle's first HARD violation for a candidate day, or null when it validates. */
  check(vehicleId: string, run: Run): Violation | null {
    const key = `${vehicleId}:${run.map((t) => t.map((o) => o.id).join(",")).join("|")}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const trips: PlanTrip[] = run.map((orders, i) => ({
      ref: `${vehicleId}#${i + 1}`,
      vehicleId,
      tripNo: i + 1,
      orders,
    }));
    const r = validatePlan({ date: this.env.date, trips }, this.env.ref, {
      cfg: this.env.cfg,
      unavailableVehicleIds: this.env.unavailable,
      fuelUsedThisWeekMl: this.env.fuel,
    });
    const first = r.violations.find((v) => v.severity === "HARD") ?? null;
    this.cache.set(key, first);
    return first;
  }

  runWith(order: PlanOrder, p: Placement): Run {
    const run = this.tripsOf(p.vehicleId);
    if (p.kind === "JOIN") {
      const joined = run.map((t, i) => (i === p.slot ? [...t, order] : t));
      return p.swap ? [...joined].reverse() : joined;
    }
    return p.first ? [[order], ...run] : [...run, [order]];
  }

  apply(order: PlanOrder, p: Placement): void {
    this.runs.set(p.vehicleId, this.runWith(order, p));
  }

  remove(orderId: string): void {
    for (const [vid, run] of this.runs) {
      if (!run.some((t) => t.some((o) => o.id === orderId))) continue;
      const next = run.map((t) => t.filter((o) => o.id !== orderId)).filter((t) => t.length > 0);
      if (next.length) this.runs.set(vid, next);
      else this.runs.delete(vid);
    }
  }

  /**
   * Candidate placements for an order, best first: join an open trip of the same brand and district (tightest fit
   * first), then a new trip on the vehicle that wastes the least reefer or van capability, then the smallest vehicle
   * that holds the group's remaining demand (else the largest), preferring a vehicle's free second slot.
   */
  placements(order: PlanOrder, outlet: Outlet, remaining: { weightG: number; volumeL: number }): Placement[] {
    const env = this.env;
    const key = groupKey(outlet);
    const joins: { p: Placement; slack: number; id: string }[] = [];
    const news: { p: Placement; score: readonly number[]; id: string }[] = [];
    for (const v of env.fleet) {
      if (env.unavailable.has(v.id) || !staticallyEligible(order, outlet, v)) continue;
      const run = this.tripsOf(v.id);
      run.forEach((t, slot) => {
        const head = t[0] && outletOrNull(t[0], env.ref);
        if (!head || groupKey(head) !== key) return;
        const used = t.reduce((s, o) => s + o.volumeL, 0) + order.volumeL;
        joins.push({
          p: { kind: "JOIN", vehicleId: v.id, slot, swap: false },
          slack: v.volumeCapL - used,
          id: `${v.id}#${slot}`,
        });
        if (run.length > 1)
          joins.push({
            p: { kind: "JOIN", vehicleId: v.id, slot, swap: true },
            slack: v.volumeCapL - used,
            id: `${v.id}#${slot}~`,
          });
      });
      if (run.length < env.cfg.maxTripsPerVehicle) {
        const waste =
          (v.temp === "reefer" && order.temp !== "chilled" ? 1 : 0) +
          (v.type === "van" && outlet.parking !== "van_only" ? 1 : 0);
        const fits = v.volumeCapL >= remaining.volumeL && v.weightCapG >= remaining.weightG;
        const fitScore = fits ? v.volumeCapL - remaining.volumeL : -v.volumeCapL;
        const score = [waste, fits ? 0 : 1, fitScore, run.length ? 0 : 1];
        news.push({ p: { kind: "NEW", vehicleId: v.id, first: false }, score, id: v.id });
        if (run.length)
          news.push({ p: { kind: "NEW", vehicleId: v.id, first: true }, score: [...score.slice(0, 3), 2], id: v.id });
      }
    }
    joins.sort((a, b) => a.slack - b.slack || cmp(a.id, b.id));
    news.sort((a, b) => cmpScore(a.score, b.score) || cmp(a.id, b.id));
    return [...joins.map((j) => j.p), ...news.map((n) => n.p)];
  }

  /** Places the order at its first valid placement. Returns the placement, or null. */
  tryPlace(
    order: PlanOrder,
    outlet: Outlet,
    remaining: { weightG: number; volumeL: number },
    skip?: (p: Placement) => boolean,
  ): Placement | null {
    for (const p of this.placements(order, outlet, remaining)) {
      if (skip?.(p)) continue;
      if (this.check(p.vehicleId, this.runWith(order, p)) === null) {
        this.apply(order, p);
        return p;
      }
    }
    return null;
  }

  /** The first rule broken by the best placement, with that placement, or null when some placement is valid. */
  firstFailure(
    order: PlanOrder,
    outlet: Outlet,
    remaining: { weightG: number; volumeL: number },
  ): { v: Violation; p: Placement } | "FITS" | null {
    let first: { v: Violation; p: Placement } | null = null;
    for (const p of this.placements(order, outlet, remaining)) {
      const v = this.check(p.vehicleId, this.runWith(order, p));
      if (v === null) return "FITS";
      if (!first || (first.v.code === "TRIP_LIMIT_EXCEEDED" && v.code !== "TRIP_LIMIT_EXCEEDED")) first = { v, p };
    }
    return first;
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpScore(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function makeEnv(
  date: LocalDate,
  depot: string | null,
  ref: ReferenceData,
  cfg: RulesConfig,
  ctx: Pick<AllocationInput, "unavailableVehicleIds" | "breakdownVehicleIds" | "fuelUsedThisWeekMl">,
): Env {
  const fleet = [...ref.vehicles.values()]
    .filter((v) => depot === null || v.depot === depot)
    .sort((a, b) => cmp(a.id, b.id));
  return {
    date,
    ref,
    cfg,
    fleet,
    unavailable: ctx.unavailableVehicleIds ?? new Set(),
    breakdown: ctx.breakdownVehicleIds ?? new Set(),
    fuel: ctx.fuelUsedThisWeekMl ?? new Map(),
  };
}

// ---- Explanation ----------------------------------------------------------------------------------------------------

const REASON_FOR: Partial<Record<ViolationCode, ReasonCode>> = {
  WEIGHT_CAP_EXCEEDED: "CAPACITY_WEIGHT",
  VOLUME_CAP_EXCEEDED: "CAPACITY_VOLUME",
  REEFER_REQUIRED: "REEFER_SHORTAGE",
  VAN_REQUIRED: "VAN_SHORTAGE",
  TIME_BUDGET_EXCEEDED: "TIME_BUDGET",
  // Booklet rule 7 is "trips and time": a vehicle with both trips used has no time left for this order.
  TRIP_LIMIT_EXCEEDED: "TIME_BUDGET",
  WINDOW_MISSED: "WINDOW_INFEASIBLE",
  MALL_WINDOW_VIOLATION: "WINDOW_INFEASIBLE",
  FUEL_QUOTA_EXCEEDED: "FUEL_QUOTA",
  VEHICLE_UNAVAILABLE: "VEHICLE_IN_WORKSHOP",
};

function consequences(order: PlanOrder & Partial<AllocationOrder>, env: Env) {
  const nextServiceableDate = operatingDateAfter(env.date, env.ref.calendar);
  return {
    nextServiceableDate,
    daysUnserved: daysBetween(order.requestedDate ?? order.deliveryDate, nextServiceableDate),
    consecutiveDeferrals: (order.deferredCount ?? 0) + 1,
  };
}

/** Whether an order fits on an empty vehicle, alone: the feasibility of the order in principle. */
function aloneFailure(order: PlanOrder, v: Vehicle, draft: Draft): Violation | null {
  return draft.check(v.id, [[order]]);
}

function explainWith(
  order: PlanOrder & Partial<AllocationOrder>,
  draft: Draft,
  env: Env,
  remaining: { weightG: number; volumeL: number },
  scoreInputs: ScoreInputs | null,
  rankOf: (id: string) => number | undefined,
): DeferralExplanation {
  const base = { orderId: order.id, scoreInputs, ...consequences(order, env) };
  const outlet = outletOrNull(order, env.ref);
  if (!outlet) {
    return {
      ...base,
      reasonCode: "OTHER",
      causeKind: "UNAVOIDABLE_INFEASIBLE",
      bindingConstraint: "ORDER_UNASSIGNED_UNKNOWN",
      displacedBy: [],
      note: `unknown outlet ${order.outletId}`,
    };
  }

  const eligible = env.fleet.filter((v) => staticallyEligible(order, outlet, v));
  if (!eligible.length) {
    const depotFleet = env.fleet.filter((v) => v.depot === outlet.depot);
    const [reasonCode, binding, note]: [ReasonCode, ViolationCode | "NO_ELIGIBLE_VEHICLE", string] =
      order.temp === "chilled" && !depotFleet.some((v) => v.temp === "reefer")
        ? ["REEFER_SHORTAGE", "REEFER_REQUIRED", "no refrigerated vehicle at this depot"]
        : outlet.parking === "van_only" && !depotFleet.some((v) => v.type === "van")
          ? ["VAN_SHORTAGE", "VAN_REQUIRED", "no van at this depot"]
          : !depotFleet.some((v) => order.weightG <= v.weightCapG)
            ? ["CAPACITY_WEIGHT", "WEIGHT_CAP_EXCEEDED", "heavier than any vehicle's capacity"]
            : !depotFleet.some((v) => order.volumeL <= v.volumeCapL)
              ? ["CAPACITY_VOLUME", "VOLUME_CAP_EXCEEDED", "larger than any vehicle's capacity"]
              : ["OTHER", "NO_ELIGIBLE_VEHICLE", "no vehicle can carry this order"];
    return {
      ...base,
      reasonCode,
      causeKind: "UNAVOIDABLE_INFEASIBLE",
      bindingConstraint: binding,
      displacedBy: [],
      note,
    };
  }

  const available = eligible.filter((v) => !env.unavailable.has(v.id));
  const aloneOk = available.filter((v) => aloneFailure(order, v, draft) === null);
  if (!aloneOk.length) {
    const workshopOk = eligible.filter(
      (v) => env.unavailable.has(v.id) && draft.check(v.id, [[order]])?.code === "VEHICLE_UNAVAILABLE",
    );
    const usable = workshopOk.filter((v) => {
      const probe = new Draft({ ...env, unavailable: new Set() });
      return probe.check(v.id, [[order]]) === null;
    });
    if (usable.length) {
      const broken = usable.every((v) => env.breakdown.has(v.id));
      return {
        ...base,
        reasonCode: broken ? "VEHICLE_BREAKDOWN" : "VEHICLE_IN_WORKSHOP",
        causeKind: "UNAVOIDABLE_INFEASIBLE",
        bindingConstraint: "VEHICLE_UNAVAILABLE",
        displacedBy: [],
        note: `only ${usable.map((v) => v.id).join(", ")} could carry it, and ${usable.length > 1 ? "they are" : "it is"} unavailable`,
      };
    }
    const first = available[0] ? aloneFailure(order, available[0], draft) : null;
    const code = first?.code ?? "NO_ELIGIBLE_VEHICLE";
    const reasonCode = first
      ? (REASON_FOR[first.code] ?? "OTHER")
      : order.temp === "chilled"
        ? "REEFER_SHORTAGE"
        : outlet.parking === "van_only"
          ? "VAN_SHORTAGE"
          : "OTHER";
    return {
      ...base,
      reasonCode,
      causeKind: "UNAVOIDABLE_INFEASIBLE",
      bindingConstraint: code,
      displacedBy: [],
      note: first
        ? `not feasible on any available vehicle even alone (${code})`
        : "every eligible vehicle is unavailable",
    };
  }

  const failure = draft.firstFailure(order, outlet, remaining);
  if (failure === "FITS") {
    const style = outlet.brand !== "Fresh";
    return {
      ...base,
      reasonCode: style ? "MOVED_BY_POLICY" : "OTHER",
      causeKind: "CHOICE",
      bindingConstraint: null,
      displacedBy: [],
      note: style
        ? "a feasible slot exists; Style/Tech moved a day by policy"
        : "a feasible slot exists; deferred by choice (note required)",
    };
  }
  // No placement at all: every eligible vehicle has used both of its trips.
  const bindingCode: ViolationCode = failure?.v.code ?? "TRIP_LIMIT_EXCEEDED";
  const scarce: ReasonCode | null =
    order.temp === "chilled" ? "REEFER_SHORTAGE" : outlet.parking === "van_only" ? "VAN_SHORTAGE" : null;
  const reasonCode = scarce ?? REASON_FOR[bindingCode] ?? "OTHER";
  const myRank = rankOf(order.id) ?? Number.POSITIVE_INFINITY;
  const holderVehicle = failure?.p.vehicleId ?? aloneOk[0]?.id ?? "";
  const holders = draft.tripsOf(holderVehicle).flat();
  const displacedBy = holders
    .filter((o) => (rankOf(o.id) ?? Number.NEGATIVE_INFINITY) <= myRank)
    .sort((a, b) => (rankOf(a.id) ?? 0) - (rankOf(b.id) ?? 0) || cmp(a.id, b.id))
    .slice(0, 5)
    .map((o) => o.id);
  return {
    ...base,
    reasonCode,
    causeKind: "UNAVOIDABLE_POOL_EXHAUSTED",
    bindingConstraint: bindingCode,
    displacedBy,
    note: failure
      ? `best slot on ${failure.p.vehicleId} breaks ${bindingCode}`
      : "every eligible vehicle has used both trips",
  };
}

/** A repeat deferral or an OTHER reason requires a justification. */
export function deferralNoteRequired({
  reasonCode,
  deferredLastRun,
}: {
  readonly reasonCode?: ReasonCode;
  readonly deferredLastRun: boolean;
}): boolean {
  return reasonCode === "OTHER" || deferredLastRun;
}

/**
 * Explains why `order` is not in `finalPlan` (a proposal or the dispatcher's draft). An order that would still fit
 * somewhere was deferred by `CHOICE`.
 */
export function explainDeferral(
  order: PlanOrder & Partial<AllocationOrder>,
  finalPlan: { readonly date: LocalDate; readonly trips: readonly PlanTrip[] },
  ref: ReferenceData,
  cfg: RulesConfig = DEFAULT_RULES_CONFIG,
  ctx: Pick<AllocationInput, "unavailableVehicleIds" | "breakdownVehicleIds" | "fuelUsedThisWeekMl"> & {
    readonly rankOf?: (orderId: string) => number | undefined;
  } = {},
): DeferralExplanation {
  const outlet = outletOrNull(order, ref);
  const env = makeEnv(finalPlan.date, outlet?.depot ?? null, ref, cfg, ctx);
  const draft = new Draft(env);
  const byVehicle = new Map<string, PlanTrip[]>();
  for (const t of finalPlan.trips) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
  for (const [vid, trips] of byVehicle)
    draft.runs.set(
      vid,
      trips.sort((a, b) => a.tripNo - b.tripNo).map((t) => t.orders),
    );
  const isAllocation = order.brand !== undefined && order.requestedDate !== undefined;
  const scoreInputs = isAllocation
    ? scoreInputsOf(order as AllocationOrder, cfg, { date: finalPlan.date, calendar: ref.calendar })
    : null;
  return explainWith(
    order,
    draft,
    env,
    { weightG: order.weightG, volumeL: order.volumeL },
    scoreInputs,
    ctx.rankOf ?? (() => undefined),
  );
}

// ---- proposePlan ----------------------------------------------------------------------------------------------------

/** Proposes a plan for a day where demand may exceed capacity. Pure and deterministic. */
export function proposePlan(
  input: AllocationInput,
  ref: ReferenceData,
  cfg: RulesConfig = DEFAULT_RULES_CONFIG,
): AllocationResult {
  const trace: string[] = [];
  const env = makeEnv(input.date, input.depot, ref, cfg, input);
  const draft = new Draft(env);

  // 1. Inputs, in a canonical order so the result does not depend on the caller's order.
  const orders = [...input.orders].sort((a, b) => cmp(a.id, b.id));
  const available = env.fleet.filter((v) => !env.unavailable.has(v.id));
  trace.push(
    `inputs: ${orders.length} orders for ${input.date} at ${input.depot}; ${available.length} of ${env.fleet.length} vehicles available`,
  );

  // 4. Rank (the whole day, lexicographic).
  const ranked = rankOrders(orders, cfg, { date: input.date, calendar: ref.calendar });
  const rankOf = new Map(ranked.map((r) => [r.order.id, r.rank]));
  const rankFn = (id: string) => rankOf.get(id);

  // 2. Eligibility and 3. partition into (brand, district) groups within each budget class.
  const outlets = new Map<string, Outlet>();
  const groups = new Map<string, RankedOrder[]>();
  const unplaceable: RankedOrder[] = [];
  for (const r of ranked) {
    const outlet = outletOrNull(r.order, ref);
    const ok =
      outlet && r.order.deliveryDate === input.date && available.some((v) => staticallyEligible(r.order, outlet, v));
    if (!outlet || !ok) {
      unplaceable.push(r);
      continue;
    }
    outlets.set(r.order.id, outlet);
    const key = `${budgetClassOf(outlet.brand)}|${groupKey(outlet)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  trace.push(`groups: ${[...groups.entries()].map(([k, g]) => `${k}=${g.length}`).join(", ") || "none"}`);
  for (const r of unplaceable) trace.push(`#${r.rank} ${r.order.id}: no available vehicle is eligible`);

  const pending = new Set(ranked.map((r) => r.order.id));
  const remainingFor = (order: AllocationOrder, outlet: Outlet) => {
    let weightG = 0;
    let volumeL = 0;
    for (const r of groups.get(`${budgetClassOf(outlet.brand)}|${groupKey(outlet)}`) ?? []) {
      if (!pending.has(r.order.id) && r.order.id !== order.id) continue;
      weightG += r.order.weightG;
      volumeL += r.order.volumeL;
    }
    return { weightG, volumeL };
  };

  // 5 + 6. Build trips in global rank order; every placement is sequenced, timed and validated on its vehicle.
  const deferred: RankedOrder[] = [];
  for (const r of ranked) {
    const outlet = outlets.get(r.order.id);
    if (!outlet) {
      pending.delete(r.order.id);
      deferred.push(r);
      continue;
    }
    const p = draft.tryPlace(r.order, outlet, remainingFor(r.order, outlet));
    pending.delete(r.order.id);
    if (p) trace.push(`#${r.rank} ${r.order.id} (${r.scoreInputs.priorityClass}) -> ${describe(p)}`);
    else {
      deferred.push(r);
      trace.push(`#${r.rank} ${r.order.id} (${r.scoreInputs.priorityClass}) -> no valid placement`);
    }
  }

  // 7. Improve: bounded, deterministic local search.
  let budget = cfg.localSearchIterationCap;
  let moves = 0;
  let improved = true;
  while (improved && budget > 0) {
    improved = false;
    for (const d of [...deferred].sort((a, b) => a.rank - b.rank)) {
      const outlet = outlets.get(d.order.id);
      if (!outlet) continue;
      const result = improveFor(d, outlet);
      if (result) {
        moves++;
        trace.push(`improve: ${result}`);
        improved = true;
        break;
      }
      if (budget <= 0) break;
    }
  }

  /**
   * Tries to serve deferred order d. Lexicographic priority means only higher-priority orders matter to d, so the
   * lower-priority ones are set aside, d is placed (directly, or after relocating, moving or dissolving a trip of
   * higher-priority orders), and the lower-priority orders are put back in rank order where they still fit.
   */
  function improveFor(d: RankedOrder, outlet: Outlet): string | null {
    const trial = draft.clone();
    const lower = ranked.filter((r) => r.rank > d.rank && trial.placed().has(r.order.id));
    for (const r of lower) trial.remove(r.order.id);
    const how = placeWithMoves(trial, d, outlet);
    if (!how) return null;
    let kept = 0;
    for (const r of lower) {
      const o = outlets.get(r.order.id);
      if (o && trial.tryPlace(r.order, o, { weightG: r.order.weightG, volumeL: r.order.volumeL })) kept++;
    }
    commit(trial);
    return `served ${d.order.id} (#${d.rank}) ${how}; ${kept} of ${lower.length} lower-priority orders kept`;
  }

  /** Places d on `trial`, directly or with one structural move. Mutates `trial` only on success. */
  function placeWithMoves(trial: Draft, d: RankedOrder, outlet: Outlet): string | null {
    const full = { weightG: d.order.weightG, volumeL: d.order.volumeL };
    if (trial.tryPlace(d.order, outlet, full)) return "directly";
    const candidates = [...trial.runs.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .filter(([vid]) => {
        const v = ref.vehicles.get(vid);
        return v !== undefined && staticallyEligible(d.order, outlet, v);
      });
    for (const [vid, run] of candidates) {
      for (let slot = 0; slot < run.length; slot++) {
        const trip = run[slot] ?? [];
        // Relocate one order off a trip of d's group, then join d to it.
        const head = trip[0] && outlets.get(trip[0].id);
        if (head && groupKey(head) === groupKey(outlet)) {
          for (const p of trip) {
            if (--budget < 0) return null;
            const pOutlet = outlets.get(p.id);
            if (!pOutlet) continue;
            const t = trial.clone();
            t.remove(p.id);
            if (!t.tryPlace(p, pOutlet, { weightG: p.weightG, volumeL: p.volumeL }, (pl) => pl.vehicleId === vid))
              continue;
            if (!t.tryPlace(d.order, outlet, full, (pl) => pl.vehicleId !== vid)) continue;
            adopt(trial, t);
            return `after relocating ${p.id}`;
          }
        }
        // Move the whole trip to another vehicle, or dissolve it into other trips, to free this vehicle for d.
        for (const w of env.fleet) {
          if (w.id === vid || env.unavailable.has(w.id)) continue;
          const target = trial.tripsOf(w.id);
          if (target.length >= cfg.maxTripsPerVehicle) continue;
          if (--budget < 0) return null;
          const t = trial.clone();
          for (const o of trip) t.remove(o.id);
          const moved = [
            [...target, trip],
            [trip, ...target],
          ].find((r) => t.check(w.id, r) === null);
          if (!moved) continue;
          t.runs.set(w.id, moved);
          if (!t.tryPlace(d.order, outlet, full, (pl) => pl.vehicleId !== vid)) continue;
          adopt(trial, t);
          return `after moving a trip from ${vid} to ${w.id}`;
        }
        if (--budget < 0) return null;
        const t = trial.clone();
        for (const o of trip) t.remove(o.id);
        const byRank = [...trip].sort((a, b) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0));
        const allMoved = byRank.every((o) => {
          const oo = outlets.get(o.id);
          return oo
            ? t.tryPlace(o, oo, { weightG: o.weightG, volumeL: o.volumeL }, (pl) => pl.vehicleId === vid) !== null
            : false;
        });
        if (allMoved && t.tryPlace(d.order, outlet, full, (pl) => pl.vehicleId !== vid)) {
          adopt(trial, t);
          return `after re-placing a trip of ${trip.length} off ${vid}`;
        }
      }
    }
    // Merge two trips of one brand and district onto one of their vehicles, freeing a trip slot.
    const tripsList: { vid: string; slot: number; key: string; orders: readonly PlanOrder[] }[] = [];
    for (const [vid, run] of [...trial.runs.entries()].sort((a, b) => cmp(a[0], b[0]))) {
      run.forEach((orders, slot) => {
        const h = orders[0] && outlets.get(orders[0].id);
        if (h) tripsList.push({ vid, slot, key: groupKey(h), orders });
      });
    }
    for (const a of tripsList) {
      for (const b of tripsList) {
        if (a === b || a.key !== b.key) continue;
        if (--budget < 0) return null;
        const t = trial.clone();
        for (const o of b.orders) t.remove(o.id);
        // a's slot index may shift when b was on the same vehicle before it.
        const run = t.tripsOf(a.vid);
        const idx = run.findIndex(
          (orders) => orders.length === a.orders.length && orders.every((o, i) => o.id === a.orders[i]?.id),
        );
        if (idx < 0) continue;
        const merged = run.map((orders, i) => (i === idx ? [...orders, ...b.orders] : orders));
        if (t.check(a.vid, merged) !== null) continue;
        t.runs.set(a.vid, merged);
        if (!t.tryPlace(d.order, outlet, full)) continue;
        adopt(trial, t);
        return `after merging trips on ${a.vid} and ${b.vid}`;
      }
    }
    return null;
  }

  function adopt(into: Draft, from: Draft) {
    into.runs.clear();
    for (const [k, v] of from.runs) into.runs.set(k, v);
  }

  function commit(trial: Draft) {
    adopt(draft, trial);
    const now = draft.placed();
    deferred.length = 0;
    for (const r of ranked) if (!now.has(r.order.id)) deferred.push(r);
  }

  // 8. Probe: try every deferred order against the final plan until no single insertion succeeds.
  let probing = true;
  while (probing) {
    probing = false;
    for (const d of [...deferred]) {
      const outlet = outlets.get(d.order.id);
      if (!outlet) continue;
      const p = draft.tryPlace(d.order, outlet, { weightG: d.order.weightG, volumeL: d.order.volumeL });
      if (p) {
        trace.push(`probe: ${d.order.id} still fit -> ${describe(p)}`);
        deferred.splice(deferred.indexOf(d), 1);
        probing = true;
      }
    }
  }

  // Explain each deferral against the final plan.
  const explanations = deferred
    .sort((a, b) => a.rank - b.rank)
    .map((d) => {
      const e = explainWith(
        d.order,
        draft,
        env,
        { weightG: d.order.weightG, volumeL: d.order.volumeL },
        d.scoreInputs,
        rankFn,
      );
      trace.push(
        `defer #${d.rank} ${d.order.id}: ${e.causeKind} ${e.reasonCode}${e.bindingConstraint ? ` (${e.bindingConstraint})` : ""}`,
      );
      return e;
    });

  // 9. Output.
  const trips: PlanTrip[] = [];
  for (const [vid, run] of [...draft.runs.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    run.forEach((orders, i) => {
      const t: PlanTrip = { ref: "", vehicleId: vid, tripNo: i + 1, orders };
      trips.push({ ...t, orders: sequenceStops(t, ref) });
    });
  }
  const numbered = trips.map((t, i) => ({ ...t, ref: `T${String(i + 1).padStart(3, "0")}` }));

  const servedIds = draft.placed();
  const vol = (ids: (o: AllocationOrder) => boolean) => {
    const out: Record<BudgetClass, number> = { FRESH: 0, STYLE_TECH: 0 };
    for (const o of orders) {
      const outlet = ref.outlets.get(o.outletId);
      if (outlet && ids(o)) out[budgetClassOf(outlet.brand)] += o.volumeL;
    }
    return out;
  };
  const usedVehicles = new Set(numbered.map((t) => t.vehicleId));
  const usedOf = (pred: (v: Vehicle) => boolean) =>
    [...usedVehicles].filter((id) => {
      const v = ref.vehicles.get(id);
      return v ? pred(v) : false;
    }).length;
  const stats: AllocationStats = {
    orders: orders.length,
    served: servedIds.size,
    deferred: explanations.length,
    demandVolumeL: vol(() => true),
    servedVolumeL: vol((o) => servedIds.has(o.id)),
    vehiclesAvailable: available.length,
    vehiclesUsed: usedVehicles.size,
    tripSlotsAvailable: available.length * cfg.maxTripsPerVehicle,
    tripsUsed: numbered.length,
    reefers: {
      available: available.filter((v) => v.temp === "reefer").length,
      used: usedOf((v) => v.temp === "reefer"),
    },
    vans: { available: available.filter((v) => v.type === "van").length, used: usedOf((v) => v.type === "van") },
    localSearchMoves: moves,
  };
  trace.push(
    `result: ${stats.served} served on ${stats.tripsUsed} trips / ${stats.vehiclesUsed} vehicles, ${stats.deferred} deferred`,
  );
  return { trips: numbered, deferrals: explanations, stats, trace };
}

function describe(p: Placement): string {
  if (p.kind === "JOIN") return `${p.vehicleId} trip ${p.slot + 1}${p.swap ? " (trips swapped)" : ""}`;
  return `${p.vehicleId} new trip${p.first ? " (first)" : ""}`;
}
