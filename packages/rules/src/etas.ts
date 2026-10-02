// Stop sequence, departures and ETAs for a vehicle's day (spec/domain/trip-time-and-budgets.md §4.4, ADR 0003).
//
// Two ETAs per stop:
// - validation ETA: the Booklet model. Trip 2 departs when trip 1's trip_minutes have elapsed (no return, no reload).
//   Only this one can raise WINDOW_MISSED or TIME_BUDGET_EXCEEDED.
// - display ETA: what stores, loaders and drivers see. Trip 2 departs after trip 1 ends, drives back (= outbound time)
//   and reloads (RELOAD_BUFFER_MIN). If only this one misses a window, the validator warns LATE_RISK.
import type { RulesConfig } from "./config";
import { DEFAULT_RULES_CONFIG } from "./config";
import type { PlanOrder, PlanTrip } from "./plan";
import { outletOf } from "./plan";
import type { Outlet, ReferenceData } from "./reference";
import type { TripTimeBreakdown } from "./trip-time";
import { computeTripTime } from "./trip-time";
import type { Minutes, TimeWindow } from "./units";
import { intersectWindows } from "./units";

export interface StopTiming {
  /** When the vehicle reaches the outlet. */
  readonly arrival: Minutes;
  /** When unloading starts: arrival, or the window open if the vehicle was early. This is the stop's ETA. */
  readonly start: Minutes;
  readonly wait: Minutes;
  /** When the vehicle leaves: start + service allowance. */
  readonly leave: Minutes;
}

export interface StopEta {
  readonly orderId: string;
  readonly outletId: string;
  /** 0-based position in the trip. The loader loads in reverse. */
  readonly seq: number;
  /** Outlet window ∩ mall window; null when they do not overlap (the stop can never be on time). */
  readonly window: TimeWindow | null;
  readonly validation: StopTiming;
  readonly display: StopTiming;
  readonly onTimeValidation: boolean;
  readonly onTimeDisplay: boolean;
}

export interface TripSchedule {
  readonly trip: PlanTrip;
  readonly time: TripTimeBreakdown;
  readonly departure: { readonly validation: Minutes; readonly display: Minutes };
  /** When the vehicle leaves its last stop. */
  readonly end: { readonly validation: Minutes; readonly display: Minutes };
  readonly stops: readonly StopEta[];
}

export type EtaConfig = Pick<
  RulesConfig,
  "freshFirstDepartureMinute" | "tradingDayStartMinute" | "reloadBufferMin" | "validationEtaIncludesReturn"
>;

/** Outlet window ∩ mall window (constraint 8). */
export function effectiveWindow(outlet: Outlet): TimeWindow | null {
  return outlet.mallWindow ? intersectWindows(outlet.window, outlet.mallWindow) : outlet.window;
}

/** Stops in delivery order: earliest window close first, then district, then order id. */
export function sequenceStops(trip: PlanTrip, ref: Pick<ReferenceData, "outlets">): PlanOrder[] {
  const keyed = trip.orders.map((order) => {
    const outlet = outletOf(order, ref);
    return { order, close: effectiveWindow(outlet)?.close ?? -1, district: outlet.district };
  });
  keyed.sort((a, b) => a.close - b.close || compareText(a.district, b.district) || compareText(a.order.id, b.order.id));
  return keyed.map((k) => k.order);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Schedules a vehicle's trips for the day, in trip-number order.
 *
 * - Fresh trip 1 departs at `freshFirstDepartureMinute` (03:30).
 * - Any other trip departs at the latest of: its earliest start (trading day start for Style/Tech; after the previous
 *   trip for trip 2) and the first stop's window open minus the outbound time, so it does not wait at the first stop.
 * - Early arrivals wait until the window opens.
 */
export function computeRunSchedule(
  trips: readonly PlanTrip[],
  ref: ReferenceData,
  cfg: EtaConfig = DEFAULT_RULES_CONFIG,
): TripSchedule[] {
  const ordered = [...trips].sort((a, b) => a.tripNo - b.tripNo || compareText(a.ref, b.ref));
  const out: TripSchedule[] = [];
  let prev: TripSchedule | undefined;
  for (const trip of ordered) {
    const time = computeTripTime(trip, ref);
    const stops = sequenceStops(trip, ref);
    const firstOpen = stops[0] ? (effectiveWindow(outletOf(stops[0], ref))?.open ?? 0) : 0;
    const notEarly = firstOpen - time.outboundMin;

    let validationDep: Minutes;
    let displayDep: Minutes;
    if (!prev) {
      const first =
        time.budgetClass === "FRESH" ? cfg.freshFirstDepartureMinute : Math.max(cfg.tradingDayStartMinute, notEarly);
      validationDep = first;
      displayDep = first;
    } else {
      const floor = time.budgetClass === "STYLE_TECH" ? cfg.tradingDayStartMinute : 0;
      displayDep = Math.max(floor, notEarly, prev.end.display + prev.time.outboundMin + cfg.reloadBufferMin);
      validationDep = cfg.validationEtaIncludesReturn
        ? displayDep
        : Math.max(floor, notEarly, prev.departure.validation + prev.time.totalMin);
    }

    const validation = walk(stops, time, validationDep, ref);
    const display = walk(stops, time, displayDep, ref);
    const etas: StopEta[] = stops.map((order, seq) => {
      const window = effectiveWindow(outletOf(order, ref));
      const v = validation[seq] as StopTiming;
      const d = display[seq] as StopTiming;
      return {
        orderId: order.id,
        outletId: order.outletId,
        seq,
        window,
        validation: v,
        display: d,
        onTimeValidation: window !== null && v.start <= window.close,
        onTimeDisplay: window !== null && d.start <= window.close,
      };
    });
    const schedule: TripSchedule = {
      trip,
      time,
      departure: { validation: validationDep, display: displayDep },
      end: { validation: validation.at(-1)?.leave ?? validationDep, display: display.at(-1)?.leave ?? displayDep },
      stops: etas,
    };
    out.push(schedule);
    prev = schedule;
  }
  return out;
}

function walk(
  stops: readonly PlanOrder[],
  time: TripTimeBreakdown,
  departure: Minutes,
  ref: ReferenceData,
): StopTiming[] {
  const timings: StopTiming[] = [];
  const interStop = stops.length > 1 ? time.interStopMin / (stops.length - 1) : 0;
  let t = departure + time.outboundMin;
  stops.forEach((order, i) => {
    if (i > 0) t += interStop;
    const window = effectiveWindow(outletOf(order, ref));
    const arrival = t;
    const start = window ? Math.max(arrival, window.open) : arrival;
    const leave = start + (time.handlingByOrder[order.id] ?? 0);
    timings.push({ arrival, start, wait: start - arrival, leave });
    t = leave;
  });
  return timings;
}

export interface EtaContext {
  readonly cfg?: EtaConfig;
  /** The same vehicle's earlier trips that day, which set this trip's departure. */
  readonly previousTrips?: readonly PlanTrip[];
}

/** ETAs for one trip, in delivery order. */
export function computeEtas(trip: PlanTrip, ref: ReferenceData, ctx: EtaContext = {}): readonly StopEta[] {
  const run = computeRunSchedule([...(ctx.previousTrips ?? []), trip], ref, ctx.cfg);
  return run.find((s) => s.trip === trip)?.stops ?? [];
}

/** The store-facing ETA band: `etaWindowMin` wide, centred on the ETA, starting on a 5-minute mark. */
export function etaBand(eta: Minutes, cfg: Pick<RulesConfig, "etaWindowMin"> = DEFAULT_RULES_CONFIG): TimeWindow {
  const from = Math.max(0, Math.floor((eta - cfg.etaWindowMin / 2) / 5) * 5);
  return { open: from, close: from + cfg.etaWindowMin };
}
