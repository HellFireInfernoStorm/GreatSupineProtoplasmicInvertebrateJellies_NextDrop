import type { ApiDto } from "@nextdrop/contracts";

// Pulling the change feed from an online role (spec/sync/change-feed.md). The Store and the Dispatcher keep no local
// copy: a feed row only says that what a screen shows is stale.

export const FEED_LIMIT = 200;

type Changes = ApiDto<"changesResponse">;

/**
 * Where to pull from next, and whether anything changed. The first answer only sets the starting point: what
 * happened before the screen opened is already in what the screen loaded.
 */
export function advance(
  cursor: string | null,
  response: Pick<Changes, "items" | "head">,
  limit: number = FEED_LIMIT,
): { cursor: string; changed: boolean } {
  if (cursor === null) return { cursor: response.head, changed: false };
  // Fewer rows than the limit means caught up: jump to the head. Otherwise carry on from the last row.
  const next = response.items.length < limit ? response.head : response.items.at(-1)!.seq;
  return { cursor: next, changed: response.items.length > 0 && next !== cursor };
}
