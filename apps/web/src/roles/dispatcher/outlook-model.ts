import type { ApiDto } from "@nextdrop/contracts";
import { addDays, dayOfWeek, isoWeekOf, type LocalDate } from "@nextdrop/rules";

// D5 Capacity outlook (ADR 0056): the forecast per ISO week against usable fleet and reefer capacity, with the
// calendar flags and the stats and takeaways the screen shows. Pure, so the screen only presents it.

export const OUTLOOK_WEEKS = 7;
/** Load at or above this percent is "tight". */
export const TIGHT_PERCENT = 95;
/** Load above this percent is "over". */
export const OVER_PERCENT = 100;
/** A week has headroom at this percent or less: 10% or more spare. */
export const HEADROOM_PERCENT = 90;

export type LoadLevel = "over" | "tight" | "ok";
type OutlookItem = ApiDto<"outlookResponse">["items"][number];
type CalendarDay = ApiDto<"calendarDay">;

export interface OutlookWeek {
  /** "2026-W45" */
  key: string;
  isoWeek: number;
  monday: LocalDate;
  saturday: LocalDate;
  demandM3: number;
  chilledM3: number;
  capacityM3: number;
  reeferM3: number;
  /** Forecast over capacity, rounded to a whole percent; null without capacity. */
  loadPercent: number | null;
  chilledLoadPercent: number | null;
  level: LoadLevel;
  chilledLevel: LoadLevel;
  /** Both fleet and reefer have 10% or more spare. */
  headroom: boolean;
  payday: boolean;
  /** The festival in the week (Mon–Sun) and its date, from the calendar. */
  festival: { name: string; date: LocalDate } | null;
}

export type Insight =
  | { kind: "overFleet"; week: OutlookWeek }
  | { kind: "overReefer"; week: OutlookWeek; bookBy: LocalDate | null }
  | { kind: "paydayTight"; weeks: OutlookWeek[]; range: [number, number] }
  | { kind: "tight"; weeks: OutlookWeek[] }
  | { kind: "allHeadroom"; count: number }
  | { kind: "noneOver" };

export interface OutlookModel {
  weeks: OutlookWeek[];
  peak: OutlookWeek;
  chilledPeak: OutlookWeek;
  paydayWeeks: OutlookWeek[];
  /** Lowest and highest load of the payday weeks, or null without any. */
  paydayRange: [number, number] | null;
  paydayLevel: LoadLevel;
  headroomWeeks: OutlookWeek[];
  insights: Insight[];
}

/** The seven weeks from the Monday of the planning date's ISO week. `to` is the last Sunday. */
export function outlookWindow(
  date: LocalDate,
  weeks = OUTLOOK_WEEKS,
): { from: LocalDate; to: LocalDate; weeks: number } {
  const from = addDays(date, -dayOfWeek(date));
  return { from, to: addDays(from, 7 * weeks - 1), weeks };
}

const weekKey = (isoYear: number, isoWeek: number) => `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
const m3 = (litres: number) => litres / 1000;
const percent = (used: number, capacity: number) => (capacity > 0 ? Math.round((used / capacity) * 100) : null);

export function loadLevel(loadPercent: number | null, used = 0): LoadLevel {
  if (loadPercent === null) return used > 0 ? "over" : "ok";
  if (loadPercent > OVER_PERCENT) return "over";
  return loadPercent >= TIGHT_PERCENT ? "tight" : "ok";
}

/** Builds the screen model, or null when the outlook has no rows for the window. */
export function buildOutlook(
  date: LocalDate,
  items: readonly OutlookItem[],
  calendar: readonly CalendarDay[],
  weeksAhead = OUTLOOK_WEEKS,
): OutlookModel | null {
  const { from } = outlookWindow(date, weeksAhead);
  const byWeek = new Map<string, OutlookItem[]>();
  for (const item of items) {
    const key = weekKey(item.isoYear, item.isoWeek);
    byWeek.set(key, [...(byWeek.get(key) ?? []), item]);
  }
  const days = new Map(calendar.map((day) => [day.date, day]));
  const weeks: OutlookWeek[] = [];
  for (let i = 0; i < weeksAhead; i++) {
    const monday = addDays(from, 7 * i);
    const { isoYear, isoWeek } = isoWeekOf(monday);
    const key = weekKey(isoYear, isoWeek);
    const rows = byWeek.get(key);
    if (!rows?.length) continue;
    // Capacity repeats on every brand row of a week; demand is per brand.
    const demandM3 = m3(rows.reduce((sum, row) => sum + row.demandVolumeL, 0));
    const chilledM3 = m3(rows.reduce((sum, row) => sum + row.chilledVolumeL, 0));
    const capacityM3 = m3(rows[0]!.capacityVolumeL);
    const reeferM3 = m3(rows[0]!.reeferCapacityVolumeL);
    const loadPercent = percent(demandM3, capacityM3);
    const chilledLoadPercent = percent(chilledM3, reeferM3);
    const weekDays = Array.from({ length: 7 }, (_, d) => days.get(addDays(monday, d))).filter(
      (day): day is CalendarDay => day !== undefined,
    );
    // The festival date itself has the full ramp; the days before it may carry the name with a smaller ramp.
    const festivalDay = weekDays
      .filter((day) => day.festival !== null)
      .reduce<CalendarDay | null>((best, day) => (best && best.festivalRamp >= day.festivalRamp ? best : day), null);
    weeks.push({
      key,
      isoWeek,
      monday,
      saturday: addDays(monday, 5),
      demandM3,
      chilledM3,
      capacityM3,
      reeferM3,
      loadPercent,
      chilledLoadPercent,
      level: loadLevel(loadPercent, demandM3),
      chilledLevel: loadLevel(chilledLoadPercent, chilledM3),
      headroom:
        (loadPercent ?? Infinity) <= HEADROOM_PERCENT &&
        (chilledM3 === 0 || (chilledLoadPercent ?? Infinity) <= HEADROOM_PERCENT),
      payday: weekDays.some((day) => day.isPayday),
      festival: festivalDay ? { name: festivalDay.festival!, date: festivalDay.date } : null,
    });
  }
  if (!weeks.length) return null;

  const maxBy = (value: (week: OutlookWeek) => number) =>
    weeks.reduce((best, week) => (value(week) > value(best) ? week : best));
  const paydayWeeks = weeks.filter((week) => week.payday);
  const range = (list: OutlookWeek[]): [number, number] | null => {
    const loads = list.map((week) => week.loadPercent).filter((value): value is number => value !== null);
    return loads.length ? [Math.min(...loads), Math.max(...loads)] : null;
  };
  const paydayRange = range(paydayWeeks);
  const headroomWeeks = weeks.filter((week) => week.headroom);

  const insights: Insight[] = [];
  for (const week of weeks) if (week.level === "over") insights.push({ kind: "overFleet", week });
  for (const week of weeks) {
    if (week.chilledLevel !== "over") continue;
    // A hired reefer is booked by the Friday a week before the Friday ahead of the week.
    const bookBy = addDays(week.monday, -10);
    insights.push({ kind: "overReefer", week, bookBy: bookBy >= date ? bookBy : null });
  }
  const paydayTight = paydayWeeks.filter((week) => week.level === "tight");
  const paydayTightRange = range(paydayTight);
  if (paydayTightRange) insights.push({ kind: "paydayTight", weeks: paydayTight, range: paydayTightRange });
  const tight = weeks.filter(
    (week) =>
      !paydayTight.includes(week) &&
      week.level !== "over" &&
      week.chilledLevel !== "over" &&
      (week.level === "tight" || week.chilledLevel === "tight"),
  );
  if (tight.length) insights.push({ kind: "tight", weeks: tight });
  if (!insights.length)
    insights.push(
      headroomWeeks.length === weeks.length ? { kind: "allHeadroom", count: weeks.length } : { kind: "noneOver" },
    );

  const paydayLevel: LoadLevel = paydayRange ? loadLevel(paydayRange[1]) : "ok";
  return {
    weeks,
    peak: maxBy((week) => week.demandM3),
    chilledPeak: maxBy((week) => week.chilledM3),
    paydayWeeks,
    paydayRange,
    paydayLevel,
    headroomWeeks,
    insights,
  };
}

/** Round chart ticks: a 1, 2, 2.5 or 5 step that covers `max` in about four steps. */
export function chartScale(max: number, steps = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}
