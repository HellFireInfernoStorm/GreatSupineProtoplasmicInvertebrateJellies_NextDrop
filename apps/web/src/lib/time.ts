// Display formats (agent-docs/design/design-system.md §3.7): 24-hour HH:MM, and a short day such as "Tue 29 Sep".
// Instants are stored in UTC and always shown in Asia/Colombo, whatever the device's zone.

const ZONE = "Asia/Colombo";
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Full calendar date comparison, including year, in the display zone. */
export function sameDisplayDay(instant: string, nowMs: number): boolean {
  return dateFormat.format(new Date(instant)) === dateFormat.format(new Date(nowMs));
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// en-US for the names: en-GB abbreviates September as "Sept", and the design writes "Sep".
const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "06:12" */
export function formatTime(instant: Date | string): string {
  return timeFormat.format(typeof instant === "string" ? new Date(instant) : instant);
}

export function formatWeekday(instant: Date | string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: ZONE }).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}

/** "Tue 29 Sep" */
export function formatDay(instant: Date | string): string {
  const parts = dayFormat.formatToParts(typeof instant === "string" ? new Date(instant) : instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}
