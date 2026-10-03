import type { Calendar, CalendarDay } from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";

export const localDateOf = (date: Date): string => date.toISOString().slice(0, 10);
export const dateOnly = (local: string): Date => new Date(`${local}T00:00:00.000Z`);

/**
 * The reference calendar as the rules `Calendar`. It is read-only at runtime, so it is loaded once; an empty table
 * (unseeded database) is not cached, and dates outside it follow the rules defaults (ADR 0018).
 */
export function createCalendarSource(prisma: PrismaClient) {
  let cached: Promise<Calendar> | undefined;
  async function load(): Promise<Calendar> {
    const rows = await prisma.calendarDay.findMany();
    const days = new Map<string, CalendarDay>(
      rows.map((row) => [
        localDateOf(row.date),
        {
          date: localDateOf(row.date),
          dow: row.dow,
          isoYear: row.isoYear,
          isoWeek: row.isoWeek,
          isPayday: row.isPayday,
          festival: row.festival,
          festivalRamp: row.festivalRamp.toNumber(),
          isHoliday: row.isHoliday,
          monsoon: row.monsoon,
          isOperating: row.isOperating,
        },
      ]),
    );
    if (days.size === 0) cached = undefined;
    return days;
  }
  return {
    get(): Promise<Calendar> {
      cached ??= load().catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
      return cached;
    },
  };
}

export type CalendarSource = ReturnType<typeof createCalendarSource>;
