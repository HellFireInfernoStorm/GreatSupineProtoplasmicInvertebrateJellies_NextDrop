import { conflictKindSchema, conflictResolutionSchema, type ApiDtoInput } from "@nextdrop/contracts";
import type { PrismaClient } from "../../generated/prisma/client";
import { readFeedHint } from "../feed";

type FieldConflict = ApiDtoInput<"fieldConflict">;

/**
 * `POST /sync/conflicts` (ADR 0042): the outcome of each of the caller's own held facts, named by clientEventId.
 * IDs that are unknown, another user's or not held are left out, so the answer never reveals other users' events.
 * Conflicts are never deleted outside a demo reset, so a device can ask at any time after it resumes.
 */
export async function heldOutcomes(prisma: PrismaClient, userId: string, clientEventIds: string[], now: Date) {
  const conflicts = await prisma.conflict.findMany({
    where: {
      heldEvent: { clientEventId: { in: clientEventIds }, actorUserId: userId, disposition: "HELD" },
    },
    include: { heldEvent: { select: { clientEventId: true } } },
    orderBy: { id: "asc" },
  });
  // Read after the conflicts: every resolution listed committed with its feed rows, so this head covers them.
  const hint = await readFeedHint(prisma);
  const items = conflicts.map((conflict): FieldConflict => {
    const base = {
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
  });
  return { items, serverTime: now.toISOString(), feedHead: hint.head };
}
