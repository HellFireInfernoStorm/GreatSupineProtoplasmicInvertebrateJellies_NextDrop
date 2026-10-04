import type { ApiDto } from "@nextdrop/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { callApi } from "../../../lib/api";
import { queryClient } from "../../../lib/queryClient";

// The Store's pull of the change feed (spec/sync/change-feed.md). The Store is an online role: it keeps no local copy,
// so a feed row only tells it that what it shows is stale, and it reads the screens' queries again.

const LIMIT = 200;
const POLL_MS = 15_000;

type Changes = ApiDto<"changesResponse">;

/**
 * Where to pull from next, and whether anything changed. The first answer only sets the starting point: what
 * happened before the screen opened is already in what the screen loaded.
 */
export function advance(
  cursor: string | null,
  response: Pick<Changes, "items" | "head">,
  limit: number = LIMIT,
): { cursor: string; changed: boolean } {
  if (cursor === null) return { cursor: response.head, changed: false };
  // Fewer rows than the limit means caught up: jump to the head. Otherwise carry on from the last row.
  const next = response.items.length < limit ? response.head : response.items.at(-1)!.seq;
  return { cursor: next, changed: response.items.length > 0 && next !== cursor };
}

/** Mounted once in the Store frame: refreshes every Store query when the feed has a new row for this outlet. */
export function useStoreFeed(): void {
  const cursor = useRef<string | null>(null);
  const changes = useQuery({
    // Outside the "store" key, so refreshing the Store queries does not restart the feed itself.
    queryKey: ["store-feed"],
    queryFn: () => callApi("changes", { query: { after: cursor.current ?? "0", limit: LIMIT } }),
    refetchInterval: POLL_MS,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (!changes.data) return;
    const next = advance(cursor.current, changes.data);
    cursor.current = next.cursor;
    if (next.changed) void queryClient.invalidateQueries({ queryKey: ["store"] });
  }, [changes.data]);
}
