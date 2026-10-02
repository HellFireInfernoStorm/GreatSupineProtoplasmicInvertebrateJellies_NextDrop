// RulesConfig: every tunable of the rules core in one typed object (spec/rules-core/config.md, spec/assumptions.md).
import type { Minutes } from "./units";

/** Priority classes in the lexicographic policy (spec/domain/priority-policy.md, ADR 0009). */
export const PRIORITY_CLASSES = [
  "CHILLED_FRESH",
  "OTHER_FRESH",
  "STYLE_TECH_DEFERRED_YESTERDAY",
  "STYLE_TECH_DAYS_SINCE_SERVED",
  "STYLE_TECH_REMAINING",
] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

export interface RulesConfig {
  /** `CUTOFF_TIME`: orders for D close at this minute on D-1 (Asia/Colombo). */
  readonly cutoffMinute: Minutes;
  /** `FRESH_FIRST_DEPARTURE`: Fresh trip 1 departs at the Fresh window start. */
  readonly freshFirstDepartureMinute: Minutes;
  /** End of the Fresh operating window (Fresh must arrive before stores open). */
  readonly freshWindowEndMinute: Minutes;
  /** `TRADING_DAY_START`: earliest Style/Tech departure. */
  readonly tradingDayStartMinute: Minutes;
  /** Fresh time budget per vehicle per day, across its Fresh trips. */
  readonly freshBudgetMin: Minutes;
  /** Style and Tech combined time budget per vehicle per day. */
  readonly styleTechBudgetMin: Minutes;
  readonly maxTripsPerVehicle: number;
  /** `RELOAD_BUFFER_MIN`: between trip 1's return and trip 2's departure, display ETA only. */
  readonly reloadBufferMin: Minutes;
  /** `FUEL_INCLUDE_RETURN`: fuel counts the return leg to the depot. */
  readonly fuelIncludeReturn: boolean;
  /** `ETA_WINDOW_MIN`: width of the store-facing ETA band. */
  readonly etaWindowMin: Minutes;
  /** ADR 0003: when true, the validation ETA uses the display ETA model (return leg and reload buffer). */
  readonly validationEtaIncludesReturn: boolean;
  /** ADR 0009: the lexicographic priority order, highest first. A permutation of `PRIORITY_CLASSES`. */
  readonly priorityOrder: readonly PriorityClass[];
  /** Aging guard: an order deferred at least this many times sorts first within its class. */
  readonly agingDeferralCount: number;
  /** `LOW_FUEL_MARGIN` warns when less than this percentage of a vehicle's weekly fuel quota is left. */
  readonly lowFuelMarginPct: number;
  /** Cap on local-search moves in the allocator. */
  readonly localSearchIterationCap: number;
  /** Seed for the allocator's local-search PRNG, so proposals are reproducible. */
  readonly localSearchSeed: number;
}

export const DEFAULT_RULES_CONFIG: RulesConfig = Object.freeze({
  cutoffMinute: 16 * 60,
  freshFirstDepartureMinute: 3 * 60 + 30,
  freshWindowEndMinute: 8 * 60,
  tradingDayStartMinute: 8 * 60,
  freshBudgetMin: 270,
  styleTechBudgetMin: 480,
  maxTripsPerVehicle: 2,
  reloadBufferMin: 15,
  fuelIncludeReturn: true,
  etaWindowMin: 30,
  validationEtaIncludesReturn: false,
  priorityOrder: Object.freeze([...PRIORITY_CLASSES]),
  agingDeferralCount: 2,
  lowFuelMarginPct: 10,
  localSearchIterationCap: 2000,
  localSearchSeed: 1,
});

/** Defaults with `overrides` applied. Throws if the result is inconsistent. */
export function resolveRulesConfig(overrides: Partial<RulesConfig> = {}): RulesConfig {
  const cfg: RulesConfig = { ...DEFAULT_RULES_CONFIG, ...overrides };
  const problems: string[] = [];
  const minuteKeys = [
    "cutoffMinute",
    "freshFirstDepartureMinute",
    "freshWindowEndMinute",
    "tradingDayStartMinute",
  ] as const;
  for (const k of minuteKeys) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0 || cfg[k] > 24 * 60) problems.push(`${k} must be a minute of the day`);
  }
  const countKeys = [
    "freshBudgetMin",
    "styleTechBudgetMin",
    "maxTripsPerVehicle",
    "reloadBufferMin",
    "etaWindowMin",
    "agingDeferralCount",
    "lowFuelMarginPct",
    "localSearchIterationCap",
    "localSearchSeed",
  ] as const;
  for (const k of countKeys) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0) problems.push(`${k} must be a non-negative integer`);
  }
  if (cfg.freshWindowEndMinute <= cfg.freshFirstDepartureMinute)
    problems.push("the Fresh window must end after it starts");
  const order = cfg.priorityOrder;
  if (order.length !== PRIORITY_CLASSES.length || PRIORITY_CLASSES.some((c) => !order.includes(c))) {
    problems.push(`priorityOrder must list each of ${PRIORITY_CLASSES.join(", ")} exactly once`);
  }
  if (problems.length) throw new RangeError(`invalid RulesConfig: ${problems.join("; ")}`);
  return Object.freeze({ ...cfg, priorityOrder: Object.freeze([...order]) });
}
