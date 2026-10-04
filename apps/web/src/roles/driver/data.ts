import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import type { FieldSnapshot } from "@nextdrop/contracts";
import { useSession } from "../../lib/session";
import { fieldRepository } from "../../sync";
import type { FieldReceipt, LocalConflict, OutboxEntry, QueuedBlob } from "../../sync/database";
export const planKey = (userId: string, snapshot: FieldSnapshot) =>
  `driverPlan:${userId}:${snapshot.resetEpoch}:${snapshot.scope.date}:${snapshot.role === "DRIVER" ? snapshot.scope.vehicle.id : ""}`;
export type ConflictLocal = LocalConflict;
type State = {
  snapshot: FieldSnapshot | null;
  events: OutboxEntry[];
  blobs: QueuedBlob[];
  receipts: FieldReceipt[];
  conflicts: ConflictLocal[];
  baseline: number | null;
  loaded: boolean;
};
export function useDriverData(): State {
  const { user } = useSession();
  const [data, setData] = useState<State>({
    snapshot: null,
    events: [],
    blobs: [],
    receipts: [],
    conflicts: [],
    baseline: null,
    loaded: false,
  });
  useEffect(() => {
    const db = fieldRepository.db;
    const subscription = liveQuery(async () => {
      const snapshot = await fieldRepository.snapshot(user.id);
      const events = await db.outbox.where("actor.userId").equals(user.id).sortBy("deviceSeq");
      const blobs = await db.blobQueue.where("userId").equals(user.id).toArray();
      const records = await db.meta.where("key").startsWith("fieldReceipt:").toArray();
      const receipts = records
        .map((row) => row.value as FieldReceipt)
        .filter((r) => r.userId === user.id && r.resetEpoch === snapshot?.resetEpoch && r.date === snapshot.scope.date);
      const conflicts = await db.conflictsLocal.where("userId").equals(user.id).toArray();
      const baseline = snapshot ? ((await db.value<number>(planKey(user.id, snapshot))) ?? snapshot.planVersion) : null;
      return { snapshot, events, blobs, receipts, conflicts, baseline, loaded: true };
    }).subscribe({ next: setData, error: () => setData((s) => ({ ...s, loaded: true })) });
    return () => subscription.unsubscribe();
  }, [user.id]);
  useEffect(() => {
    if (!data.snapshot) return;
    const snapshot = data.snapshot;
    void fieldRepository.db.transaction("rw", fieldRepository.db.meta, async () => {
      const key = planKey(user.id, snapshot);
      if ((await fieldRepository.db.value(key)) === undefined) await fieldRepository.db.set(key, snapshot.planVersion);
    });
  }, [data.snapshot, user.id]);
  return data;
}
