import { z } from "zod";

/** Change feed row kinds (spec/sync/change-feed.md). */
export const FEED_KINDS = [
  "plan_published",
  "order_changed",
  "conflict_opened",
  "conflict_resolved",
  "notification_created",
  "run_updated",
  "availability_changed",
] as const;

export type FeedKind = (typeof FEED_KINDS)[number];

export const feedKindSchema = z.enum(FEED_KINDS);
