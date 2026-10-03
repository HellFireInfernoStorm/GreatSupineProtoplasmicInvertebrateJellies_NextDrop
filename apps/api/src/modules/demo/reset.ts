// Demo reset (spec/data/seed-and-demo.md §15.2, ADR 0007, ADR 0033). Restores the operational tables to a preset.
import { colomboInstant } from "@nextdrop/rules";
import { runSeed } from "../../../prisma/seed";
import type { PrismaClient } from "../../generated/prisma/client";
import type { Clock } from "../../lib/clock";
import type { Notifier } from "../notifications";
import { tickPlanningDays } from "../planning";

/** Walkthrough step 1: Mon 28 Sep 2026, 14:00 Asia/Colombo, two hours before the cutoff for Tue 29 Sep. */
export const BEFORE_CUTOFF_TIME = new Date(colomboInstant("2026-09-28", 14 * 60));

export interface ResetDependencies {
  prisma: PrismaClient;
  /** The schema the models live in; raw SQL needs it on the search path. */
  schema: string;
  clock: Clock;
  notifier: Notifier;
}

/**
 * Reset to `before-cutoff`: clear the operational tables, restore the seeded story day (which increments
 * `resetEpoch` once, because it writes), move the clock to `BEFORE_CUTOFF_TIME` and open the planning days.
 */
export async function resetToBeforeCutoff(deps: ResetDependencies, actorUserId: string | null): Promise<void> {
  const { prisma, clock } = deps;
  const searchPath = `"${deps.schema.replaceAll('"', '""')}"`;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('search_path', ${searchPath}, true)`;
    // Every operational table. Reference data, products, users, sessions, devices, weekly history, the change feed
    // and its counter stay: clients learn of the reset from `resetEpoch`, which the SSE hub polls.
    // TRUNCATE skips the row-level immutability triggers on order_events and plan_versions (ADR 0033).
    await tx.$executeRaw`TRUNCATE TABLE "conflicts", "blobs", "plan_version_changes", "plan_versions", "plan_drafts", "deferrals", "trip_stops", "trips", "order_events", "order_lines", "orders", "outlet_service_states", "vehicle_availability", "notifications", "planning_days"`;
  });
  await runSeed(prisma);
  await clock.set(BEFORE_CUTOFF_TIME);
  await tickPlanningDays(prisma, clock.now(), deps.notifier);
  await prisma.demoState.update({
    where: { singleton: true },
    data: { preset: "before-cutoff", lastResetBy: actorUserId, lastResetAt: clock.now() },
  });
}
