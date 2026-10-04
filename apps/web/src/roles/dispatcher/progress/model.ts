import type { ApiDto } from "@nextdrop/contracts";
import type { Tone } from "../../../ui/status";

// D4 Delivery Progress view model (agent-docs/design/screens.md §6.2, degradation-scenario.md §7.3). Everything here
// arranges what the API decided: the run state, stop counts and late risk come from `GET /dispatch/runs` (ADR 0041),
// so the screen never re-derives a rule.

export type Run = ApiDto<"run">;
export type Exception = ApiDto<"exception">;
export type Trip = Run["trips"][number];
export type Stop = Trip["stops"][number];
export type RunState = Run["state"];

/** How a card looks. Grey is no signal, never amber or red on its own: late is not lost (Style Guide). */
export const RUN_TONES = {
  ON_TRACK: "deferred", // Figma draws "Out for delivery" in the purple tone
  BEHIND: "warn",
  NO_SIGNAL: "neutral",
  ESCALATED: "danger",
  DONE: "ok",
} as const satisfies Record<RunState, Tone>;

/** Escalated and silent runs first (the dispatcher looks there), then late, moving, waiting and finished ones. */
const ORDER: Record<RunState, number> = { ESCALATED: 0, NO_SIGNAL: 1, BEHIND: 2, ON_TRACK: 3, DONE: 5 };

export const departed = (run: Run) => run.trips.some((trip) => trip.status === "DEPARTED");
export const silent = (run: Run) => run.state === "NO_SIGNAL" || run.state === "ESCALATED";
/** A run that has not left the dock yet and is not finished: "later today". */
export const waiting = (run: Run) =>
  run.state !== "DONE" && !run.trips.some((trip) => trip.status === "DEPARTED" || trip.status === "COMPLETE");

function rank(run: Run): number {
  if (run.state === "ON_TRACK") return run.lateRisk ? 2.5 : waiting(run) ? 4 : 3;
  return ORDER[run.state];
}

export function sortRuns(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => rank(a) - rank(b) || a.vehicle.displayId.localeCompare(b.vehicle.displayId));
}

/** The trip the card is about: the one on the road, else the next to leave, else the last one. */
export function currentTrip(run: Run): Trip | null {
  const trips = [...run.trips].sort((a, b) => a.plannedDepart.localeCompare(b.plannedDepart) || a.tripNo - b.tripNo);
  return (
    trips.find((t) => t.status === "DEPARTED") ??
    trips.find((t) => t.status !== "COMPLETE" && t.status !== "CANCELLED") ??
    trips.at(-1) ??
    null
  );
}

/** Every stop of the run in driving order (trips by departure, stops by sequence). */
export function runStops(run: Run): Stop[] {
  return [...run.trips]
    .sort((a, b) => a.plannedDepart.localeCompare(b.plannedDepart) || a.tripNo - b.tripNo)
    .flatMap((trip) => [...trip.stops].sort((a, b) => a.seq - b.seq));
}

/** The next stop in driving order after the ones the server counts as done. */
export function nextStop(run: Run): Stop | null {
  if (run.state === "DONE") return null;
  return runStops(run)[run.stopsDone] ?? null;
}

/** When the last stop was delivered, for a finished run. */
export function finishedAt(run: Run): string | null {
  const times = runStops(run)
    .map((s) => s.deliveredAt)
    .filter((t): t is string => t !== null)
    .sort();
  return times.at(-1) ?? null;
}

export function progressPercent(run: Run): number {
  if (run.stopsTotal === 0) return 0;
  return Math.round((run.stopsDone / run.stopsTotal) * 100);
}

/** Whole minutes from an instant to now (server clock), never negative. */
export function minutesSince(instant: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(instant)) / 60_000));
}

export interface RunSummary {
  outForDelivery: number;
  delivered: number;
  lateRisk: number;
  noSignal: number;
  later: number;
}

export function summarise(runs: readonly Run[]): RunSummary {
  return {
    outForDelivery: runs.filter((r) => r.state !== "DONE" && departed(r)).length,
    delivered: runs.filter((r) => r.state === "DONE").length,
    lateRisk: runs.filter((r) => r.state !== "DONE" && (r.lateRisk || r.state === "BEHIND" || r.state === "ESCALATED"))
      .length,
    noSignal: runs.filter(silent).length,
    later: runs.filter(waiting).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Exceptions inbox

export const INBOX_TABS = ["all", "clashes", "shortfalls", "disputes", "other"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export function tabOf(item: Exception): Exclude<InboxTab, "all"> {
  switch (item.type) {
    case "CONFLICT":
      return "clashes";
    case "SHORT":
    case "DAMAGED":
      return "shortfalls";
    case "ISSUE":
      return "disputes";
    default:
      return "other";
  }
}

/** A stable key per inbox item. Clashes and disputes use their own ids, so notification links can select them. */
export function exceptionKey(item: Exception): string {
  switch (item.type) {
    case "CONFLICT":
      return item.conflict.id;
    case "ISSUE":
      return item.issue.id;
    case "SHORT":
      return `short:${item.orderId}:${item.lineId}`;
    case "DAMAGED":
      return `damaged:${item.orderId}:${item.lineId}`;
    case "FAILED":
      return `failed:${item.order.id}`;
    case "PROBLEM":
      return item.eventId;
    case "ACK":
      return `ack:${item.tripId}:${item.planVersion}`;
  }
}

export function exceptionOrderId(item: Exception): string | null {
  switch (item.type) {
    case "CONFLICT":
      return item.conflict.orderId;
    case "ISSUE":
      return item.issue.orderId;
    case "SHORT":
    case "DAMAGED":
      return item.orderId;
    case "FAILED":
      return item.order.id;
    case "PROBLEM":
      return item.orderId;
    case "ACK":
      return null;
  }
}

export function exceptionTripId(item: Exception): string | null {
  switch (item.type) {
    case "CONFLICT":
      return item.conflict.tripId;
    case "PROBLEM":
    case "ACK":
      return item.tripId;
    default:
      return null;
  }
}

/** When the item happened, for its line in the inbox. Shortfalls and damage carry no time of their own. */
export function exceptionTime(item: Exception): string | null {
  switch (item.type) {
    case "CONFLICT":
      return item.conflict.openedAt;
    case "ISSUE":
      return item.issue.openedAt;
    case "ACK":
      return item.at;
    default:
      return null;
  }
}

/** Something the dispatcher must decide here: the rest is information (damage, problems, acknowledgements). */
export function actionable(item: Exception): boolean {
  return item.type === "CONFLICT" || item.type === "ISSUE" || item.type === "SHORT";
}

/** Clashes first (they hold a delivery fact), then disputes, shortfalls, and the information items. */
const TYPE_ORDER: Record<Exception["type"], number> = {
  CONFLICT: 0,
  ISSUE: 1,
  SHORT: 2,
  FAILED: 3,
  DAMAGED: 4,
  PROBLEM: 5,
  ACK: 6,
};
export function sortExceptions(items: readonly Exception[]): Exception[] {
  return [...items].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}

export function countByTab(items: readonly Exception[]): Record<InboxTab, number> {
  const counts: Record<InboxTab, number> = { all: items.length, clashes: 0, shortfalls: 0, disputes: 0, other: 0 };
  for (const item of items) counts[tabOf(item)] += 1;
  return counts;
}

/** Which inbox item a notification link (`?exception=`, `?order=`, `?trip=`) points at. */
export function linkedException(
  items: readonly Exception[],
  link: { exception?: string | null; order?: string | null; trip?: string | null },
): Exception | null {
  if (link.exception) {
    const hit = items.find((item) => exceptionKey(item) === link.exception);
    if (hit) return hit;
  }
  if (link.order) {
    const hit = sortExceptions(items).find((item) => exceptionOrderId(item) === link.order);
    if (hit) return hit;
  }
  if (link.trip) return sortExceptions(items).find((item) => exceptionTripId(item) === link.trip) ?? null;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Where an order sits on today's runs

export interface StopPlace {
  run: Run;
  trip: Trip;
  stop: Stop;
}

/** Order id → its stop on today's runs. */
export function stopIndex(runs: readonly Run[]): Map<string, StopPlace> {
  const index = new Map<string, StopPlace>();
  for (const run of runs)
    for (const trip of run.trips) for (const stop of trip.stops) index.set(stop.order.id, { run, trip, stop });
  return index;
}

/** Trip id → its run and trip. */
export function tripIndex(runs: readonly Run[]): Map<string, { run: Run; trip: Trip }> {
  const index = new Map<string, { run: Run; trip: Trip }>();
  for (const run of runs) for (const trip of run.trips) index.set(trip.id, { run, trip });
  return index;
}
