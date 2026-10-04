import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import type { FieldSnapshot } from "@nextdrop/contracts";
import type { OrderState } from "@nextdrop/rules";
import { useSession } from "../../lib/session";
import { fieldRepository } from "../../sync";
import type { FieldReceipt, OutboxEntry, QueuedBlob } from "../../sync/database";
import { loaderPlanKey, promoteDraft, type LoadDraft } from "./drafts";
import { projectDrafts } from "./model";
export type LoaderSnapshot = Extract<FieldSnapshot, { role: "LOADER" }>;
export interface LoaderData {
  snapshot: LoaderSnapshot | null;
  states: Record<string, OrderState>;
  events: OutboxEntry[];
  receipts: FieldReceipt[];
  blobs: QueuedBlob[];
  drafts: LoadDraft[];
  baseline: number | null;
  loaded: boolean;
  error: boolean;
}
export function useLoaderData(): LoaderData {
  const { user } = useSession();
  const [data, setData] = useState<LoaderData>({
    snapshot: null,
    states: {},
    events: [],
    receipts: [],
    blobs: [],
    drafts: [],
    baseline: null,
    loaded: false,
    error: false,
  });
  useEffect(() => {
    const db = fieldRepository.db;
    const subscription = liveQuery(() =>
      db.transaction("r", db.tables, async () => {
        const current = await fieldRepository.snapshot(user.id);
        const snapshot = current?.role === "LOADER" ? current : null;
        const events = await db.outbox.where("actor.userId").equals(user.id).sortBy("deviceSeq");
        const blobs = await db.blobQueue.where("userId").equals(user.id).toArray();
        const rows = await db.meta.where("key").startsWith("fieldReceipt:").toArray();
        const receipts = rows
          .map((r) => r.value as FieldReceipt)
          .filter(
            (r) => r.userId === user.id && r.resetEpoch === snapshot?.resetEpoch && r.date === snapshot.scope.date,
          );
        const records = await db.meta.where("key").startsWith("loaderDraft:").toArray();
        const drafts = records
          .map((r) => r.value as LoadDraft)
          .filter(
            (d) =>
              d.receipt.userId === user.id &&
              d.receipt.resetEpoch === snapshot?.resetEpoch &&
              d.receipt.date === snapshot.scope.date,
          );
        const states: Record<string, OrderState> = {};
        for (const trip of snapshot?.scope.trips ?? [])
          for (const stop of trip.stops) {
            const state = await fieldRepository.projectOrder(stop.order.id, user.id);
            if (state)
              states[stop.order.id] = projectDrafts(
                state,
                drafts.filter((d) => d.receipt.planVersion === snapshot!.planVersion),
              );
          }
        const baseline = snapshot
          ? ((await db.value<number>(loaderPlanKey(user.id, snapshot))) ?? snapshot.planVersion)
          : null;
        return { snapshot, events, receipts, blobs, states, drafts, baseline, loaded: true, error: false };
      }),
    ).subscribe({ next: setData, error: () => setData((s) => ({ ...s, error: true, loaded: true })) });
    return () => subscription.unsubscribe();
  }, [user.id]);
  useEffect(() => {
    if (!data.snapshot) return;
    const snapshot = data.snapshot;
    void fieldRepository.db
      .transaction("rw", fieldRepository.db.meta, async () => {
        const key = loaderPlanKey(user.id, snapshot);
        if ((await fieldRepository.db.value(key)) === undefined)
          await fieldRepository.db.set(key, snapshot.planVersion);
      })
      .catch(() => setData((s) => ({ ...s, error: true })));
  }, [data.snapshot, user.id]);
  useEffect(() => {
    const promote = async () => {
      for (const draft of data.drafts) await promoteDraft(fieldRepository, draft.key, user.id);
    };
    const timer = setInterval(() => void promote().catch(() => setData((s) => ({ ...s, error: true }))), 250);
    void promote().catch(() => setData((s) => ({ ...s, error: true })));
    return () => clearInterval(timer);
  }, [data.drafts, user.id]);
  return data;
}
