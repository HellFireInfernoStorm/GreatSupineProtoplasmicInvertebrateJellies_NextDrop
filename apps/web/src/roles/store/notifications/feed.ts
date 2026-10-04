import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { callApi } from "../../../lib/api";
import { advance, FEED_LIMIT as LIMIT } from "../../../lib/feed";
import { queryClient } from "../../../lib/queryClient";

// The Store's pull of the change feed (spec/sync/change-feed.md). The Store is an online role: it keeps no local copy,
// so a feed row only tells it that what it shows is stale, and it reads the screens' queries again.

export { advance };

const POLL_MS = 15_000;

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
