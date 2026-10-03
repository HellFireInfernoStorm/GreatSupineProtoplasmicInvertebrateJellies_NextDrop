// The seed (seed-and-demo.md §15.1). Idempotent: reference data, products, accounts, drivers and weekly history are
// written only where they differ from the seed; operational rows (orders, vehicle availability, service state, demo
// state) are created only when missing, so a restart never reverts demo progress. `DemoState.resetEpoch` is
// incremented only when this run wrote something (ADR 0030). Run with `pnpm db:seed`, or on start with SEED_ON_START.
import { pathToFileURL } from "node:url";
import { parseEventPayload } from "@nextdrop/contracts";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createDatabase } from "../../src/lib/database";
import { DISPATCHER_LOGIN_ID, lookup, seedAccounts } from "./accounts";
import { seedCatalogue } from "./catalogue";
import { generateServiceState, generateWeeklyHistory } from "./history";
import { colomboIso, seedOrders, type OrderSpec } from "./orders";
import { generatePeakDay, PEAK_DAY_WORKSHOP } from "./peak-day";
import { loadReference } from "./pick-fixtures";
import { dateOnly, seedReference, type ReferenceIds } from "./reference";
import { storyOrderIds, storyOrders } from "./story";
import { STORY_DATE } from "./story-fixtures";
import { syncRows, wrote, type SyncResult } from "./sync";

export const SEED_SECTIONS = [
  "reference",
  "catalogue",
  "accounts",
  "orders",
  "vehicleAvailability",
  "serviceState",
  "weeklyHistory",
  "demoState",
] as const;
export type SeedSection = (typeof SEED_SECTIONS)[number];

export interface SeedSummary {
  readonly sections: Readonly<Record<SeedSection, SyncResult>>;
  readonly wrote: boolean;
  readonly resetEpoch: number;
}

/** Every order the seed creates: the story fixtures, then the bulk peak day. */
export function seedOrderSpecs(): OrderSpec[] {
  const ref = loadReference();
  return [...storyOrders(ref.calendar), ...generatePeakDay(ref, storyOrderIds(ref.calendar))];
}

export async function runSeed(db: PrismaClient): Promise<SeedSummary> {
  const ref = loadReference();
  const orders = seedOrderSpecs();

  const { ids, result: reference } = await seedReference(db);
  const { productIds, result: catalogue } = await seedCatalogue(db);
  const { userIds, result: accounts } = await seedAccounts(db, ids);
  const sections: Record<SeedSection, SyncResult> = {
    reference,
    catalogue,
    accounts,
    orders: await seedOrders(db, orders, ids, userIds, productIds),
    vehicleAvailability: await seedVehicleAvailability(db, ids, lookup(userIds, DISPATCHER_LOGIN_ID)),
    serviceState: await seedServiceState(db, ids, generateServiceState(ref, orders)),
    weeklyHistory: await syncRows({
      rows: generateWeeklyHistory(ref, orders),
      key: (r) => `${r.depot}|${r.brand}|${r.isoYear}|${r.isoWeek}`,
      existing: () => db.weeklyDemandHistory.findMany(),
      create: (rows) => db.weeklyDemandHistory.createMany({ data: rows }),
      update: (id, data) => db.weeklyDemandHistory.update({ where: { id }, data }),
    }),
    demoState: { created: 0, updated: 0 },
  };

  const changed = Object.values(sections).some(wrote);
  const current = await db.demoState.findUnique({ where: { singleton: true } });
  let resetEpoch = current?.resetEpoch ?? 0;
  if (!current) {
    resetEpoch = 1;
    await db.demoState.create({ data: { preset: "before-cutoff", resetEpoch, lastResetAt: new Date() } });
    sections.demoState = { created: 1, updated: 0 };
  } else if (changed) {
    resetEpoch = current.resetEpoch + 1;
    await db.demoState.update({ where: { id: current.id }, data: { resetEpoch, lastResetAt: new Date() } });
    sections.demoState = { created: 0, updated: 1 };
  }
  return { sections, wrote: changed || !current, resetEpoch };
}

/** Workshop vehicles on the story date, each with its `VEHICLE_AVAILABILITY_CHANGED` event, set by the dispatcher. */
async function seedVehicleAvailability(db: PrismaClient, ids: ReferenceIds, dispatcherId: string): Promise<SyncResult> {
  const date = dateOnly(STORY_DATE);
  const existing = new Set((await db.vehicleAvailability.findMany({ where: { date } })).map((v) => v.vehicleId));
  const setAt = new Date(colomboIso("2026-09-28", "07:30"));
  let created = 0;
  for (const { vehicleId: displayId, reason } of PEAK_DAY_WORKSHOP) {
    const vehicleId = lookup(ids.vehicles, displayId);
    if (existing.has(vehicleId)) continue;
    await db.$transaction([
      db.vehicleAvailability.create({
        data: { vehicleId, date, status: "IN_WORKSHOP", reason, setBy: dispatcherId, setAt },
      }),
      db.orderEvent.create({
        data: {
          type: "VEHICLE_AVAILABILITY_CHANGED",
          source: "SERVER",
          actorRole: "DISPATCHER",
          actorUserId: dispatcherId,
          capturedAt: setAt,
          receivedAt: setAt,
          vehicleId,
          payload: parseEventPayload("VEHICLE_AVAILABILITY_CHANGED", {
            vehicleId,
            date: STORY_DATE,
            status: "IN_WORKSHOP",
            reason,
          }),
        },
      }),
    ]);
    created++;
  }
  return { created, updated: 0 };
}

async function seedServiceState(
  db: PrismaClient,
  ids: ReferenceIds,
  states: ReturnType<typeof generateServiceState>,
): Promise<SyncResult> {
  const existing = new Set((await db.outletServiceState.findMany()).map((s) => s.outletId));
  const missing = states
    .map((s) => ({
      outletId: lookup(ids.outlets, s.outletId),
      lastServedDate: dateOnly(s.lastServedDate),
      deferredLastRun: s.deferredLastRun,
    }))
    .filter((s) => !existing.has(s.outletId));
  if (missing.length) await db.outletServiceState.createMany({ data: missing });
  return { created: missing.length, updated: 0 };
}

async function main(): Promise<void> {
  const database = createDatabase();
  if (!database.prisma) throw new Error("Set DATABASE_URL to seed the database.");
  try {
    const summary = await runSeed(database.prisma);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
