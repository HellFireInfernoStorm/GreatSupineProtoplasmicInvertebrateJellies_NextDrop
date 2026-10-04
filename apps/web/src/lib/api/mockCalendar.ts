import { addDays, calendarDay, dayOfWeek, type Calendar, type CalendarDay, type LocalDate } from "@nextdrop/rules";

// The mock calendar (VITE_API_MOCK=true): the default Monday-to-Saturday weeks, with paydays and festivals marked the
// way `calendar.csv` marks them, so the dispatcher's Capacity outlook has flags to show. Operating days are unchanged.

/** Festival dates by `MM-DD`, named with the codes `calendar.csv` uses. Deepavali is its 2026 date. */
const FESTIVALS: Readonly<Record<string, string>> = {
  "01-15": "thai_pongal",
  "11-08": "deepavali",
  "12-25": "christmas",
};

const noRows = new Map<LocalDate, never>();

function lastDayOfMonth(date: LocalDate): LocalDate {
  const [year, month] = date.split("-").map(Number) as [number, number];
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/** Paydays fall on the 25th and the last day of the month, or the Saturday before when that is a Sunday. */
export function isMockPayday(date: LocalDate): boolean {
  const paydays = [`${date.slice(0, 8)}25`, lastDayOfMonth(date)].map((day) =>
    dayOfWeek(day) === 6 ? addDays(day, -1) : day,
  );
  return paydays.includes(date);
}

export const MOCK_CALENDAR: Calendar = {
  get(date: LocalDate): CalendarDay | undefined {
    const festival = FESTIVALS[date.slice(5)] ?? null;
    const isPayday = isMockPayday(date);
    if (!festival && !isPayday) return undefined;
    return { ...calendarDay(date, noRows), isPayday, festival, festivalRamp: festival ? 1 : 0 };
  },
};
