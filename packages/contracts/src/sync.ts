import { z } from "zod";

/** Per-event push results (spec/sync/push-protocol.md). */
export const SYNC_RESULT_STATUSES = ["ACCEPTED", "DUPLICATE", "HELD_CONFLICT", "REJECTED"] as const;

export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];

export const syncResultStatusSchema = z.enum(SYNC_RESULT_STATUSES);
