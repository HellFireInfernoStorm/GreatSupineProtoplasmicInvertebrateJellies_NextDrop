import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import type { OrderState } from "@nextdrop/rules";
import { useSession } from "../lib/session";
import { fieldRepository, unconfirmed } from "./repository";
import { syncController } from "./controller";
import type { OutboxEntry, QueuedBlob } from "./database";

export interface SyncDiagnostics {
  pendingCount: number;
  failedItems: (OutboxEntry | QueuedBlob)[];
  heldCount: number;
  heldItems: OutboxEntry[];
  lastSyncedAt: string | null;
  simulateOffline: boolean;
}
export function useSyncDiagnostics(): SyncDiagnostics {
  const { user } = useSession();
  const [state, setState] = useState<SyncDiagnostics>({
    pendingCount: 0,
    failedItems: [],
    heldItems: [],
    heldCount: 0,
    lastSyncedAt: null,
    simulateOffline: false,
  });
  useEffect(() => {
    const db = fieldRepository.db;
    const subscription = liveQuery(async () => {
      const events = await db.outbox
        .where("[actor.userId+state]")
        .anyOf(
          [user.id, "pending"],
          [user.id, "sending"],
          [user.id, "held"],
          [user.id, "rejected"],
          [user.id, "failed"],
        )
        .toArray();
      const blobs = await db.blobQueue
        .where("[userId+state]")
        .anyOf([user.id, "pending"], [user.id, "sending"], [user.id, "failed"])
        .toArray();
      return {
        pendingCount:
          events.filter(unconfirmed).length +
          blobs.filter((b) => b.state === "pending" || b.state === "sending").length,
        failedItems: [
          ...events.filter((e) => e.state === "failed" || e.state === "rejected"),
          ...blobs.filter((b) => b.state === "failed"),
        ],
        heldCount: events.filter((e) => e.state === "held").length,
        heldItems: events.filter((e) => e.state === "held"),
        lastSyncedAt: (await db.value<string>("lastSyncedAt")) ?? null,
        simulateOffline: !!(await db.value("simulateOffline")),
      };
    }).subscribe(setState);
    return () => subscription.unsubscribe();
  }, [user.id]);
  return state;
}
export function useProjectedOrder(orderId: string): OrderState | null {
  const { user } = useSession();
  const [state, setState] = useState<OrderState | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => fieldRepository.projectOrder(orderId, user.id)).subscribe(setState);
    return () => subscription.unsubscribe();
  }, [orderId, user.id]);
  return state;
}
export async function setForceOffline(value: boolean): Promise<void> {
  await fieldRepository.db.set("simulateOffline", value);
  await syncController.syncNow();
}

/** Field screens consume this local snapshot instead of calling the network. */
export function useFieldSnapshot() {
  const { user } = useSession();
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof fieldRepository.snapshot>>>(null);
  useEffect(() => {
    const subscription = liveQuery(() => fieldRepository.snapshot(user.id)).subscribe(setSnapshot);
    return () => subscription.unsubscribe();
  }, [user.id]);
  return snapshot;
}
