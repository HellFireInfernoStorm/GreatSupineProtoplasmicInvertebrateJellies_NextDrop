import { fieldConflictContextSchema, tripSchema, type ApiDtoInput } from "@nextdrop/contracts";
import { colomboLocal } from "@nextdrop/rules";
import { z } from "zod";
import type { OrderEvent, Prisma } from "../../generated/prisma/client";
import { dateOnly, toEnvelope } from "../orders";

type Context = NonNullable<ApiDtoInput<"fieldConflict">["context"]>;
const historySchema = z.object({
  trips: z.array(tripSchema),
  deferrals: z.array(
    z.object({
      orderId: z.string(),
      reasonCode: z.string(),
      note: z.string().nullable(),
    }),
  ),
});

/** Only the owned order's historical slot leaves this module; the rest of the plan is private. */
export async function conflictContext(
  tx: Prisma.TransactionClient,
  fact: OrderEvent,
  tripId: string | null,
  openedAt: Date,
): Promise<Context> {
  const context: Context = { fact: toEnvelope(fact), original: null, changes: [] };
  if (!fact.orderId || fact.basedOnPlanVersion === null) return context;
  const trip = tripId ? await tx.trip.findUnique({ where: { id: tripId } }) : null;
  const order = !trip ? await tx.order.findUnique({ where: { id: fact.orderId }, include: { outlet: true } }) : null;
  const day = trip
    ? await tx.planningDay.findUnique({ where: { id: trip.planningDayId } })
    : order
      ? await tx.planningDay.findUnique({
          where: {
            depot_date: {
              depot: order.outlet.depot,
              date: dateOnly(colomboLocal(fact.capturedAt.getTime()).date),
            },
          },
        })
      : null;
  if (!day) return context;
  const versions = await tx.planVersion.findMany({
    where: { planningDayId: day.id, version: { gte: fact.basedOnPlanVersion }, publishedAt: { lte: openedAt } },
    include: { planVersionChange_planVersionId: { where: { orderId: fact.orderId } } },
    orderBy: { version: "asc" },
  });
  const histories = versions.map((v) => historySchema.safeParse(v.snapshot));
  const slot = (index: number) => {
    const parsed = histories[index];
    if (!parsed?.success) return null;
    for (const t of parsed.data.trips) {
      const stop = t.stops.find((s) => s.order.id === fact.orderId);
      if (stop) return { tripId: t.id, tripDisplayId: t.displayId, vehicleId: t.vehicleId, stop };
    }
    return null;
  };
  const originalIndex = versions.findIndex((v) => v.version === fact.basedOnPlanVersion);
  const original = slot(originalIndex);
  if (original && (!tripId || original.tripId === tripId)) {
    context.original = { planVersion: fact.basedOnPlanVersion, ...original };
  }
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i]!;
    if (version.version <= fact.basedOnPlanVersion) continue;
    for (const change of version.planVersionChange_planVersionId) {
      if (!["REMOVED", "DEFERRED", "MOVED_VEHICLE", "MOVED_TRIP"].includes(change.change)) continue;
      const before = versions[i - 1]?.version === version.version - 1 ? slot(i - 1) : null;
      const after = slot(i);
      const parsed = histories[i];
      const deferral = parsed?.success ? parsed.data.deferrals.find((d) => d.orderId === fact.orderId) : undefined;
      context.changes.push({
        kind: change.change as Context["changes"][number]["kind"],
        fromVersion: version.version - 1,
        toVersion: version.version,
        at: version.publishedAt.toISOString(),
        from: before ? { tripId: before.tripId, vehicleId: before.vehicleId } : null,
        to: after ? { tripId: after.tripId, vehicleId: after.vehicleId } : null,
        reasonCode: change.change === "DEFERRED" ? (deferral?.reasonCode ?? null) : null,
        note: change.change === "DEFERRED" ? (deferral?.note ?? null) : null,
      });
    }
  }
  return fieldConflictContextSchema.parse(context);
}
