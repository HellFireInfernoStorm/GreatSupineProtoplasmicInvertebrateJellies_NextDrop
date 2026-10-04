import { conflictKindSchema, conflictResolutionSchema, type ApiDtoInput } from "@nextdrop/contracts";
import type { PrismaClient } from "../../generated/prisma/client";
import { conflictContext } from "./conflict-context";

type FieldConflict = ApiDtoInput<"fieldConflict">;

/**
 * `POST /sync/conflicts` (ADR 0043): the outcome of each of the caller's own held facts, named by clientEventId.
 * IDs that are unknown, another user's or not held are left out, so the answer never reveals other users' events.
 * Conflicts are never deleted outside a demo reset, so a device can ask at any time after it resumes.
 */
export async function heldOutcomes(
  prisma: PrismaClient,
  userId: string,
  clientEventIds: string[],
  now: Date,
  includeContext = false,
) {
  return prisma.$transaction(
    async (tx) => {
      const conflicts = await tx.conflict.findMany({
        where: {
          heldEvent: { clientEventId: { in: clientEventIds }, actorUserId: userId, disposition: "HELD" },
        },
        include: { heldEvent: true },
        orderBy: { id: "asc" },
      });
      // Read after the conflicts: every resolution listed committed with its feed rows, so this head covers them.
      const counter = await tx.feedCounter.findUniqueOrThrow({ where: { singleton: true } });
      const demo = includeContext ? await tx.demoState.findUnique({ where: { singleton: true } }) : null;
      const items = await Promise.all(
        conflicts.map(async (conflict): Promise<FieldConflict> => {
          const base = {
            ...(includeContext
              ? {
                  context: await conflictContext(
                    tx,
                    conflict.heldEvent,
                    conflict.heldEvent.tripId ?? conflict.tripId,
                    conflict.openedAt,
                  ),
                }
              : {}),
            conflictId: conflict.id,
            clientEventId: conflict.heldEvent.clientEventId!,
            kind: conflictKindSchema.parse(conflict.kind),
            openedAt: conflict.openedAt.toISOString(),
          };
          if (conflict.state === "OPEN" || !conflict.resolvedAt) return { ...base, state: "OPEN" };
          return {
            ...base,
            state: "RESOLVED",
            resolution: conflictResolutionSchema.parse(conflict.resolution),
            note: conflict.note,
            resolvedAt: conflict.resolvedAt.toISOString(),
          };
        }),
      );
      return {
        items,
        serverTime: now.toISOString(),
        feedHead: counter.head.toString(),
        ...(includeContext ? { resetEpoch: demo?.resetEpoch ?? 0 } : {}),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
