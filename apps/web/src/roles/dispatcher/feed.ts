import { apiSchemas, type ApiDto, type FeedKind } from "@nextdrop/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { API_MOCK, callApi } from "../../lib/api";
import { advance, FEED_LIMIT } from "../../lib/feed";
import { queryClient } from "../../lib/queryClient";

// The Dispatcher's pull of the change feed (spec/sync/change-feed.md). The dispatcher is an online role: a feed row
// marks the queries that show its entity as stale, by kind, so D4 updates while the dispatcher watches. `/stream` only
// hints that the head moved; the 15 s poll is the fallback and nothing depends on the hint arriving.

const POLL_MS = 15_000;

/** The dispatch query names (third or fourth key part) each feed kind makes stale. */
export const STALE_BY_KIND: Record<FeedKind, readonly string[]> = {
  run_updated: ["runs", "exceptions"],
  conflict_opened: ["runs", "exceptions"],
  conflict_resolved: ["runs", "exceptions"],
  order_changed: ["runs", "exceptions", "day", "draft"],
  plan_published: ["runs", "exceptions", "day", "draft"],
  availability_changed: ["fleet"],
  notification_created: ["notifications"],
};

/** Which dispatch queries a page of feed rows makes stale. */
export function staleQueries(items: readonly Pick<ApiDto<"feedItem">, "kind">[]): Set<string> {
  return new Set(items.flatMap((item) => STALE_BY_KIND[item.kind] ?? []));
}

function invalidate(names: ReadonlySet<string>) {
  if (names.size === 0) return;
  void queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === "dispatch" && query.queryKey.some((part) => typeof part === "string" && names.has(part)),
  });
}

/** Mounted once in the Dispatcher frame. */
export function useDispatchFeed(): void {
  const cursor = useRef<string | null>(null);
  const epoch = useRef<number | null>(null);
  const changes = useQuery({
    // Outside the "dispatch" key, so refreshing the dispatch queries does not restart the feed itself.
    queryKey: ["dispatch-feed"],
    queryFn: () => callApi("changes", { query: { after: cursor.current ?? "0", limit: FEED_LIMIT } }),
    refetchInterval: POLL_MS,
    staleTime: 0,
    gcTime: 0,
  });
  const { refetch } = changes;
  useEffect(() => {
    const data = changes.data;
    if (!data) return;
    if (epoch.current !== null && epoch.current !== data.resetEpoch) {
      // A demo reset: everything on screen is from before it. Start again from the new head.
      epoch.current = data.resetEpoch;
      cursor.current = data.head;
      void queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      return;
    }
    epoch.current = data.resetEpoch;
    const first = cursor.current === null;
    const next = advance(cursor.current, data);
    cursor.current = next.cursor;
    if (!first && next.changed) invalidate(staleQueries(data.items));
    // A full page means more rows are waiting.
    if (!first && data.items.length >= FEED_LIMIT) void refetch();
  }, [changes.data, refetch]);

  useEffect(() => {
    if (API_MOCK || typeof EventSource === "undefined") return;
    let stream: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      stream = new EventSource(`/api/stream?after=${encodeURIComponent(cursor.current ?? "0")}`);
      stream.onmessage = (event) => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.data as string);
        } catch {
          return;
        }
        const hint = apiSchemas.streamHint.safeParse(raw);
        if (!hint.success || cursor.current === null) return;
        if (BigInt(hint.data.head) > BigInt(cursor.current) || hint.data.resetEpoch !== epoch.current) void refetch();
      };
      stream.onerror = () => {
        stream?.close();
        stream = null;
        // The poll keeps D4 current meanwhile; try the hint stream again later.
        retry = setTimeout(open, POLL_MS);
      };
    };
    open();
    return () => {
      if (retry) clearTimeout(retry);
      stream?.close();
    };
  }, [refetch]);
}
