// Store orders (spec/platform/api.md): placement against the server-clock cutoff, events, status and timeline.
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client";
import { createNotifier } from "../notifications";
import { createCalendarSource } from "./calendar";
import { createOrderCommands } from "./commands";
import { orderRoutes } from "./routes";

export { createCalendarSource, dateOnly, localDateOf, type CalendarSource } from "./calendar";
export { appendServerEvent, insertionOrder, toEnvelope, toRulesEvent } from "./events";
export {
  orderInclude,
  outletInclude,
  toOrderDto,
  toOutletDto,
  toTripDto,
  tripInclude,
  type OrderRecord,
  type TripRecord,
} from "./projection";
export { NO_SIGNAL_AFTER_MIN, orderResource } from "./routes";

export async function registerOrders(app: FastifyInstance, deps: { prisma: PrismaClient | null; now: () => Date }) {
  // Without a database (ops-only test servers) the store routes are not registered.
  if (!deps.prisma) return;
  const calendar = createCalendarSource(deps.prisma);
  const commands = createOrderCommands({ prisma: deps.prisma, now: deps.now, calendar, notifier: createNotifier() });
  await app.register(orderRoutes, { prisma: deps.prisma, now: deps.now, calendar, commands });
}
