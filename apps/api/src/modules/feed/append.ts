import type { FeedKind } from "@nextdrop/contracts";
import type { Prisma, Role } from "../../generated/prisma/client";

/** Who may see a feed row (ADR 0027). Fill every scope column that applies to the entity. */
export interface FeedAudience {
  roles: readonly Role[];
  depot?: string | null;
  vehicleId?: string | null;
  outletId?: string | null;
}

export interface FeedRowInput {
  kind: FeedKind;
  entity: { type: string; id: string };
  version?: number | null;
  audience: FeedAudience;
}

/**
 * Append change-feed rows. Call it as the LAST statements of a writing transaction (spec/sync/change-feed.md):
 * the counter increment locks the FeedCounter row until commit, so sequences are gap-free and commit-ordered.
 * A rollback undoes both the increment and the rows. Returns the allocated sequence numbers.
 */
export async function appendFeed(tx: Prisma.TransactionClient, rows: readonly FeedRowInput[]): Promise<bigint[]> {
  if (rows.length === 0) return [];
  for (const row of rows) {
    if (row.audience.roles.length === 0) throw new Error(`Feed row ${row.kind} ${row.entity.id} has no audience roles`);
  }
  const n = BigInt(rows.length);
  // UPDATE feed_counter SET head = head + n RETURNING head, through the schema-aware client.
  const { head } = await tx.feedCounter.update({
    where: { singleton: true },
    data: { head: { increment: n } },
    select: { head: true },
  });
  const first = head - n + 1n;
  const seqs = rows.map((_, i) => first + BigInt(i));
  await tx.changeFeed.createMany({
    data: rows.map((row, i) => ({
      seq: seqs[i]!,
      kind: row.kind,
      entityType: row.entity.type,
      entityId: row.entity.id,
      version: row.version ?? null,
      depot: row.audience.depot ?? null,
      vehicleId: row.audience.vehicleId ?? null,
      outletId: row.audience.outletId ?? null,
      roles: [...new Set(row.audience.roles)],
    })),
  });
  return seqs;
}
