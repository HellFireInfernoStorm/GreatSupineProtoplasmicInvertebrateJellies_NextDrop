// Planning (spec/planning): planning-day lifecycle, and the dispatcher's day, propose, draft, validate and fleet API.
// Publish (#48) adds to this module.
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client";
import type { Clock } from "../../lib/clock";
import { createNotifier } from "../notifications";
import { createReferenceSource } from "./reference";
import { planningRoutes } from "./routes";

export { fuelUsedThisWeek, loadDayInputs, QUEUE_STATUSES, toDraftData, toRulesPlan, type DayInputs } from "./inputs";
export { publishDay, type PublishDependencies, type PublishInput } from "./publish";
export { createReferenceSource, type Reference, type ReferenceSource } from "./reference";
export { loadCalendar, orderableDate, tickPlanningDays } from "./tick";

export async function registerPlanning(app: FastifyInstance, deps: { prisma: PrismaClient | null; clock: Clock }) {
  // Without a database (ops-only test servers) the planning routes are not registered.
  if (!deps.prisma) return;
  await app.register(planningRoutes, {
    prisma: deps.prisma,
    clock: deps.clock,
    reference: createReferenceSource(deps.prisma),
    notifier: createNotifier(deps.clock.now),
  });
}
