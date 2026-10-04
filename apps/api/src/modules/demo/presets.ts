// Demo presets (spec/data/seed-and-demo.md §15.2, ADR 0033). Each one resets to `before-cutoff`, then drives the real
// service functions on the server clock: no hand-written rows, so every run reaches the same state.
import { colomboInstant, proposePlan } from "@nextdrop/rules";
import type { demoPresetSchema } from "@nextdrop/contracts";
import type { z } from "zod";
import { DISPATCHER_LOGIN_ID } from "../../../prisma/seed/accounts";
import { PEAK_STORE_OUTLET_ID } from "../../../prisma/seed/story-fixtures";
import { createCalendarSource, createOrderCommands } from "../orders";
import { createNotifier } from "../notifications";
import { createReferenceSource, loadDayInputs, publishDay, tickPlanningDays, toDraftData } from "../planning";
import { resetToBeforeCutoff, type ResetDependencies } from "./reset";

type DemoPreset = z.infer<typeof demoPresetSchema>;

/** The presets this module can reach. The rest answer 409 `errors.demoPresetUnavailable`. */
export const BUILT_PRESETS: ReadonlySet<DemoPreset> = new Set(["before-cutoff", "orders-closed", "plan-published"]);

/** Walkthrough step 2: Mon 28 Sep 2026, 16:05 Asia/Colombo, five minutes after the cutoff for Tue 29 Sep. */
export const ORDERS_CLOSED_TIME = new Date(colomboInstant("2026-09-28", 16 * 60 + 5));

const DELIVERY_DAY = "2026-09-29";
/** Walkthrough step 1: Dilini places one dry and one chilled order for tomorrow. */
const STORY_ORDERS = [
  { sku: "FR-RICE-BAG", key: "demo-preset:step-1:dry" },
  { sku: "FR-MILK-CRATE", key: "demo-preset:step-1:chilled" },
] as const;

/** Walkthrough step 1, through the real placement command at 14:00, before the cutoff. */
async function placeStoryOrders(deps: ResetDependencies): Promise<void> {
  const { prisma, clock } = deps;
  const store = await prisma.user.findUniqueOrThrow({
    where: { loginId: PEAK_STORE_OUTLET_ID },
    select: { id: true, outletId: true },
  });
  const commands = createOrderCommands({
    prisma,
    now: clock.now,
    calendar: createCalendarSource(prisma),
    notifier: createNotifier(clock.now),
  });
  const actor = { userId: store.id, outletId: store.outletId! };
  for (const { sku, key } of STORY_ORDERS) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku }, select: { id: true } });
    await commands.place(actor, { requestedDate: DELIVERY_DAY, lines: [{ productId: product.id, qty: 1 }] }, key);
  }
}

/** Walkthrough step 2: move the clock past 16:00 and let the tick close the days (and notify the dispatchers). */
async function closeOrders(deps: ResetDependencies): Promise<void> {
  await deps.clock.set(ORDERS_CLOSED_TIME);
  await tickPlanningDays(deps.prisma, deps.clock.now(), deps.notifier);
}

/** Walkthrough steps 3 and 5: propose the stock plan for each depot's Tue 29 Sep and publish it, as the dispatcher. */
async function publishPlans(deps: ResetDependencies): Promise<void> {
  const { prisma, clock, notifier } = deps;
  const dispatcher = await prisma.user.findUniqueOrThrow({
    where: { loginId: DISPATCHER_LOGIN_ID },
    select: { id: true },
  });
  const reference = createReferenceSource(prisma);
  const days = await prisma.planningDay.findMany({
    where: { date: new Date(`${DELIVERY_DAY}T00:00:00Z`), state: "CLOSED" },
  });
  for (const day of days) {
    const inputs = await loadDayInputs(prisma, await reference.get(), day.depot, DELIVERY_DAY);
    const result = proposePlan(inputs.allocation, inputs.reference.ref);
    await prisma.$transaction([
      prisma.planDraft.create({
        data: {
          planningDayId: day.id,
          revision: 1,
          data: toDraftData(result, inputs),
          baseVersion: day.currentVersion,
          updatedBy: dispatcher.id,
        },
      }),
      prisma.planningDay.update({ where: { id: day.id }, data: { state: "PLANNING" } }),
    ]);
    await publishDay(
      { prisma, clock, reference, notifier },
      { depot: day.depot, date: DELIVERY_DAY, revision: 1, actorUserId: dispatcher.id },
    );
  }
}

/** Record which preset the demo is at, who got it there, and when on the demo clock. */
async function record(deps: ResetDependencies, preset: DemoPreset, actorUserId: string | null): Promise<void> {
  await deps.prisma.demoState.update({
    where: { singleton: true },
    data: { preset, lastResetBy: actorUserId, lastResetAt: deps.clock.now() },
  });
}

/** Reset to `preset`. `before-cutoff` is the base of every other preset. */
export async function resetToPreset(
  deps: ResetDependencies,
  preset: DemoPreset,
  actorUserId: string | null,
): Promise<void> {
  await resetToBeforeCutoff(deps, actorUserId);
  if (preset === "before-cutoff") return;
  await placeStoryOrders(deps);
  await closeOrders(deps);
  if (preset === "plan-published") await publishPlans(deps);
  await record(deps, preset, actorUserId);
}
