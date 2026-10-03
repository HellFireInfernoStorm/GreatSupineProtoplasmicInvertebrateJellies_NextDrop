// Time-driven planning-day transitions (spec/planning/flow.md §8.1 step 1, spec/domain/cutoff-and-calendar.md).
// Idempotent: run it as often as you like, from the pg-boss job or POST /demo/tick.
import {
  colomboLocal,
  cutoffAt,
  deliveryDateFor,
  type Calendar,
  type CalendarDay,
  type LocalDate,
} from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { appendFeed, type FeedRowInput } from "../feed";
import type { Notifier } from "../notifications";

const dateOnly = (date: LocalDate) => new Date(`${date}T00:00:00.000Z`);
const localDate = (date: Date) => date.toISOString().slice(0, 10);

/** The calendar as the rules core reads it, from the seeded `CalendarDay` rows. */
export async function loadCalendar(prisma: PrismaClient): Promise<Calendar> {
  const rows = await prisma.calendarDay.findMany();
  return new Map(
    rows.map((r): [LocalDate, CalendarDay] => [
      localDate(r.date),
      {
        date: localDate(r.date),
        dow: r.dow,
        isoYear: r.isoYear,
        isoWeek: r.isoWeek,
        isPayday: r.isPayday,
        festival: r.festival,
        festivalRamp: Number(r.festivalRamp),
        isHoliday: r.isHoliday,
        monsoon: r.monsoon,
        isOperating: r.isOperating,
      },
    ]),
  );
}

/** The delivery date an order placed at `now` would target: the planning day still open for orders. */
export function orderableDate(now: Date, calendar: Calendar): LocalDate {
  return deliveryDateFor(colomboLocal(now.getTime()).date, now.getTime(), calendar);
}

/**
 * For every depot: make sure the orderable date has an OPEN planning day, and move every OPEN day whose cutoff has
 * passed to CLOSED, notifying the depot's dispatchers (`orders_closed`). Returns how many days were closed.
 * Concurrent ticks are safe: a day is closed by a conditional update, so only one tick counts it.
 */
export async function tickPlanningDays(prisma: PrismaClient, now: Date, notifier: Notifier): Promise<number> {
  const calendar = await loadCalendar(prisma);
  const open = orderableDate(now, calendar);
  const depots = (
    await prisma.district.findMany({ distinct: ["depot"], select: { depot: true }, orderBy: { depot: "asc" } })
  ).map((d) => d.depot);

  let applied = 0;
  for (const depot of depots) {
    await prisma.planningDay.createMany({ data: [{ depot, date: dateOnly(open) }], skipDuplicates: true });
    const due = await prisma.planningDay.findMany({
      where: { depot, state: "OPEN", date: { lt: dateOnly(open) } },
      orderBy: { date: "asc" },
    });
    for (const day of due) {
      const date = localDate(day.date);
      const closedAt = cutoffAt(date);
      if (closedAt > now.getTime()) continue;
      const closed = await prisma.$transaction(async (tx) => {
        const { count } = await tx.planningDay.updateMany({
          where: { id: day.id, state: "OPEN" },
          data: { state: "CLOSED", ordersClosedAt: new Date(closedAt) },
        });
        if (count === 0) return false;
        const orders = await tx.order.count({
          where: { currentDate: day.date, status: { in: ["ORDERED", "DEFERRED"] }, outlet: { depot } },
        });
        const feed: FeedRowInput[] = await notifier.notify(tx, {
          kind: "orders_closed",
          audience: { role: "DISPATCHER", depot },
          params: { depot, date, orders },
          entity: { type: "planningDay", id: day.id },
        });
        await appendFeed(tx, feed);
        return true;
      });
      if (closed) applied++;
    }
  }
  return applied;
}
