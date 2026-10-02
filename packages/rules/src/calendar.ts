// Local dates, operating days and the order cutoff (spec/domain/cutoff-and-calendar.md, ADR 0018).
// Pure: no Date.now() and no time-zone library. Asia/Colombo is a fixed UTC+05:30 with no daylight saving.
import type { RulesConfig } from "./config";
import { DEFAULT_RULES_CONFIG } from "./config";
import type { Minutes } from "./units";

/** A local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Milliseconds since the Unix epoch (a UTC instant). */
export type EpochMs = number;

/** Asia/Colombo offset from UTC, in minutes. */
export const COLOMBO_UTC_OFFSET_MIN = 330;

const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60_000;
/** How far the operating-date search looks before giving up. */
const MAX_SEARCH_DAYS = 366;

/** One row of `calendar.csv`. */
export interface CalendarDay {
  readonly date: LocalDate;
  /** 0 = Monday ... 6 = Sunday, as in `calendar.csv`. */
  readonly dow: number;
  readonly isoYear: number;
  readonly isoWeek: number;
  readonly isPayday: boolean;
  readonly festival: string | null;
  /** 0 away from a festival, rising to 1 on the festival date. */
  readonly festivalRamp: number;
  readonly isHoliday: boolean;
  readonly monsoon: boolean;
  readonly isOperating: boolean;
}

/** Calendar lookup. A `Map<LocalDate, CalendarDay>` satisfies it. */
export interface Calendar {
  get(date: LocalDate): CalendarDay | undefined;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a local date. Throws on a malformed or impossible date. */
export function dayNumber(date: LocalDate): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: "${date}"`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const n = ms / MS_PER_DAY;
  if (fromDayNumber(n) !== date) throw new RangeError(`not a calendar date: "${date}"`);
  return n;
}

export function fromDayNumber(n: number): LocalDate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** 0 = Monday ... 6 = Sunday. */
export function dayOfWeek(date: LocalDate): number {
  // 1970-01-01 was a Thursday (3).
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

/** ISO-8601 week-numbering year and week. */
export function isoWeekOf(date: LocalDate): { isoYear: number; isoWeek: number } {
  const n = dayNumber(date);
  const thursday = n - dayOfWeek(date) + 3;
  const isoYear = Number(fromDayNumber(thursday).slice(0, 4));
  const jan1 = dayNumber(`${isoYear}-01-01`);
  return { isoYear, isoWeek: Math.floor((thursday - jan1) / 7) + 1 };
}

/**
 * The calendar row for a date. A date outside the calendar file is operating Monday to Saturday, with no holiday,
 * festival, payday or monsoon (the Booklet: "Waypoint operates Monday through Saturday").
 */
export function calendarDay(date: LocalDate, calendar: Calendar): CalendarDay {
  const row = calendar.get(date);
  if (row) return row;
  const dow = dayOfWeek(date);
  return {
    date,
    dow,
    ...isoWeekOf(date),
    isPayday: false,
    festival: null,
    festivalRamp: 0,
    isHoliday: false,
    monsoon: false,
    isOperating: dow !== 6,
  };
}

export function isOperatingDay(date: LocalDate, calendar: Calendar): boolean {
  return calendarDay(date, calendar).isOperating;
}

/** `date` itself when it is an operating day, otherwise the next operating date after it. */
export function nextOperatingDate(date: LocalDate, calendar: Calendar): LocalDate {
  return isOperatingDay(date, calendar) ? date : operatingDateAfter(date, calendar);
}

/** The first operating date strictly after `date`. */
export function operatingDateAfter(date: LocalDate, calendar: Calendar): LocalDate {
  let d = date;
  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    d = addDays(d, 1);
    if (isOperatingDay(d, calendar)) return d;
  }
  throw new RangeError(`no operating day within ${MAX_SEARCH_DAYS} days after ${date}`);
}

/** Operating days in `(from, to]`: 0 when `to <= from`. Used for the slip of a deferral. */
export function operatingDaysBetween(from: LocalDate, to: LocalDate, calendar: Calendar): number {
  let count = 0;
  for (let d = addDays(from, 1); dayNumber(d) <= dayNumber(to); d = addDays(d, 1)) {
    if (isOperatingDay(d, calendar)) count++;
  }
  return count;
}

/** The UTC instant of a local Asia/Colombo date and minute. */
export function colomboInstant(date: LocalDate, minute: Minutes): EpochMs {
  return dayNumber(date) * MS_PER_DAY + (minute - COLOMBO_UTC_OFFSET_MIN) * MS_PER_MIN;
}

/** The local Asia/Colombo date and minute of a UTC instant. */
export function colomboLocal(instant: EpochMs): { date: LocalDate; minute: Minutes } {
  const localMin = Math.floor(instant / MS_PER_MIN) + COLOMBO_UTC_OFFSET_MIN;
  const day = Math.floor(localMin / (24 * 60));
  return { date: fromDayNumber(day), minute: localMin - day * 24 * 60 };
}

/** Order cutoff for delivery date D: 16:00 Asia/Colombo on calendar day D-1, as a UTC instant. */
export function cutoffAt(date: LocalDate, cfg: Pick<RulesConfig, "cutoffMinute"> = DEFAULT_RULES_CONFIG): EpochMs {
  return colomboInstant(addDays(date, -1), cfg.cutoffMinute);
}

/**
 * The delivery date an order placed at `placedAt` for `requestedDate` actually targets. A non-operating request rolls
 * to the next operating date; an order placed at or after that date's cutoff moves to the next operating date after it.
 */
export function deliveryDateFor(
  requestedDate: LocalDate,
  placedAt: EpochMs,
  calendar: Calendar,
  cfg: Pick<RulesConfig, "cutoffMinute"> = DEFAULT_RULES_CONFIG,
): LocalDate {
  // An order can never target a date before the day it is placed, so start from the later of the two.
  const placedOn = colomboLocal(placedAt).date;
  const start = dayNumber(placedOn) > dayNumber(requestedDate) ? placedOn : requestedDate;
  let d = nextOperatingDate(start, calendar);
  while (placedAt >= cutoffAt(d, cfg)) d = operatingDateAfter(d, calendar);
  return d;
}
