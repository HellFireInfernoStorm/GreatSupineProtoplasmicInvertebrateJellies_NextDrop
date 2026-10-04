import { colomboLocal, type LocalDate } from "@nextdrop/rules";

// Local dates (`YYYY-MM-DD`) are Colombo calendar days. These helpers turn them into things a screen shows.

/** Midnight in Colombo on a local date, as an ISO instant the shared time formatters accept. */
export const dateInstant = (date: LocalDate) => `${date}T00:00:00+05:30`;

/** Today's local date on the server clock. */
export const todayOn = (serverNow: Date): LocalDate => colomboLocal(serverNow.getTime()).date;

const part = (options: Intl.DateTimeFormatOptions) => {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Colombo", ...options });
  return (date: LocalDate) => format.format(new Date(dateInstant(date)));
};

/** "Wed" */
export const weekdayShort = part({ weekday: "short" });
/** "Wednesday" */
export const weekdayLong = part({ weekday: "long" });
/** "30 Sep" */
export const dayMonth = (date: LocalDate) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Colombo",
    day: "numeric",
    month: "short",
  }).formatToParts(new Date(dateInstant(date)));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}`;
};

/** Whole hours and minutes left until an instant, never negative. */
export function timeLeft(untilMs: number, nowMs: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.floor((untilMs - nowMs) / 60_000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
