import type { FieldSnapshot } from "@nextdrop/contracts";
import { uuidv7 } from "uuidv7";
import { applyEvent, type OrderEvent, type OrderState } from "@nextdrop/rules";
import { tripGate, receiptMatches, latestReceipt, canRetry, receiptCovered } from "./model";
import type { FieldReceipt, QueuedBlob } from "../../sync/database";
import type { EventIntent, FieldRepository } from "../../sync/repository";
export const loaderPlanKey = (userId: string, snapshot: FieldSnapshot) =>
  `loaderPlan:${userId}:${snapshot.resetEpoch}:${snapshot.scope.date}:${snapshot.role === "LOADER" ? snapshot.scope.depot : ""}`;
export const loadKey = (userId: string, snapshot: FieldSnapshot, orderId: string, lineId: string) =>
  `load:${loaderPlanKey(userId, snapshot)}:${orderId}:${lineId}`;
export const readyKey = (userId: string, snapshot: FieldSnapshot, tripId: string) =>
  `ready:${userId}:${snapshot.resetEpoch}:${snapshot.scope.date}:${tripId}`;
export const reversalKey = (userId: string, snapshot: FieldSnapshot, orderId: string) =>
  `reversal:${loaderPlanKey(userId, snapshot)}:${orderId}`;
async function assertAvailable(repository: FieldRepository, prefix: string, feedCursor?: string) {
  const db = repository.db;
  const rows = await db.meta.where("key").startsWith(`fieldReceipt:${prefix}`).toArray();
  const receipt = latestReceipt(
    rows.map((r) => r.value as FieldReceipt),
    prefix,
  );
  const events = await db.outbox.toArray();
  if (receipt && !canRetry(receipt, events) && !(feedCursor && receiptCovered(receipt, events, feedCursor)))
    throw new Error("Already recorded");
}
export interface LoadDraft {
  label: string;
  key: string;
  receipt: Omit<FieldReceipt, "events">;
  intents: EventIntent[];
  expiresAt: number;
  capturedAt: string;
  clockOffsetMs: number;
  blob?: QueuedBlob;
}
/** Five-second Undo cancels a durable draft, never an outbox fact. Promotion is atomic and resumes after reload. */
export async function saveDraft(
  repository: FieldRepository,
  draft: Omit<LoadDraft, "key" | "expiresAt">,
  now = Date.now(),
): Promise<LoadDraft> {
  const db = repository.db;
  const value = {
    ...draft,
    receipt: { ...draft.receipt, id: `${draft.receipt.id}:${uuidv7()}` },
    key: `loaderDraft:${uuidv7()}`,
    expiresAt: now + 5000,
  };
  await db.transaction("rw", db.meta, db.runs, db.orders, db.outbox, async () => {
    const snapshot = await repository.snapshot(draft.receipt.userId);
    const reversal = draft.receipt.kind === "LOAD_REVERSED";
    if (
      !snapshot ||
      snapshot.role !== "LOADER" ||
      snapshot.resetEpoch !== draft.receipt.resetEpoch ||
      snapshot.planVersion !== draft.receipt.planVersion ||
      snapshot.scope.date !== draft.receipt.date ||
      !(reversal
        ? snapshot.scope.reversals.some((order) => order.id === draft.receipt.orderId)
        : snapshot.scope.trips.some(
            (t) => t.id === draft.receipt.tripId && t.stops.some((s) => s.order.id === draft.receipt.orderId),
          ))
    )
      throw new Error("Plan changed before save");
    if (reversal) {
      const intent = draft.intents[0];
      const state = await repository.projectOrder(draft.receipt.orderId!, draft.receipt.userId);
      if (
        !state ||
        draft.intents.length !== 1 ||
        intent?.type !== "LOAD_REVERSED" ||
        intent.subject.orderId !== draft.receipt.orderId ||
        intent.payload.orderId !== draft.receipt.orderId ||
        intent.actor.userId !== draft.receipt.userId ||
        applyEvent(state, { ...intent, id: value.receipt.id } as OrderEvent).outcome.kind !== "APPLIED"
      )
        throw new Error("Reversal unavailable");
    }
    const drafts = await db.meta.where("key").startsWith("loaderDraft:").toArray();
    await assertAvailable(repository, draft.receipt.id, reversal ? snapshot.feedCursor : undefined);
    if (drafts.some((r) => receiptMatches((r.value as LoadDraft).receipt, draft.receipt.id)))
      throw new Error("Already recorded");
    await db.set(value.key, value);
  });
  return value;
}
export async function undoDraft(
  repository: FieldRepository,
  key: string,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  const db = repository.db;
  return db.transaction("rw", db.meta, async () => {
    const draft = await db.value<LoadDraft>(key);
    if (!draft || draft.receipt.userId !== userId || now >= draft.expiresAt) return false;
    await db.meta.delete(key);
    return true;
  });
}
export async function promoteDraft(
  repository: FieldRepository,
  key: string,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  const db = repository.db;
  return db.transaction("rw", db.meta, db.runs, db.outbox, db.blobQueue, async () => {
    const draft = await db.value<LoadDraft>(key);
    if (!draft || draft.receipt.userId !== userId || now < draft.expiresAt) return false;
    // Changed-plan drafts stay saved for explicit review; never retag yesterday's work to a new plan.
    if (
      (await db.value("snapshotOwner")) !== userId ||
      (await db.value("planVersion")) !== draft.receipt.planVersion ||
      (await db.value("resetEpoch")) !== draft.receipt.resetEpoch
    )
      return false;
    if (draft.blob) await db.blobQueue.add(draft.blob);
    const entries = await repository.enqueueBatch(draft.intents, draft.receipt);
    for (const entry of entries)
      await db.outbox.update(entry.clientEventId, { capturedAt: draft.capturedAt, clockOffsetMs: draft.clockOffsetMs });
    await db.set(`fieldReceipt:${draft.receipt.id}`, {
      ...draft.receipt,
      events: entries.map((e) => ({ ...e, capturedAt: draft.capturedAt, clockOffsetMs: draft.clockOffsetMs })),
    });
    await db.meta.delete(key);
    return true;
  });
}

/** Recheck the current saved checklist inside the same transaction that records hand-over. */
export async function queueReady(
  repository: FieldRepository,
  userId: string,
  snapshot: FieldSnapshot,
  tripId: string,
): Promise<void> {
  const db = repository.db;
  await db.transaction("rw", db.meta, db.runs, db.orders, db.outbox, async () => {
    const current = await repository.snapshot(userId);
    const currentTrip = current?.scope.trips.find((r) => r.id === tripId);
    if (
      !currentTrip ||
      current?.role !== "LOADER" ||
      current.resetEpoch !== snapshot.resetEpoch ||
      current.scope.date !== snapshot.scope.date ||
      current.planVersion !== snapshot.planVersion ||
      currentTrip.status !== "PLANNED"
    )
      throw new Error("Trip changed");
    const states: Record<string, OrderState> = {};
    for (const stop of currentTrip.stops) {
      const state = await repository.projectOrder(stop.order.id, userId);
      if (!state) throw new Error("Checklist unavailable");
      states[stop.order.id] = state;
    }
    const localDrafts = await db.meta.where("key").startsWith("loaderDraft:").toArray();
    if (
      localDrafts.some((r) => (r.value as { receipt: { tripId: string } }).receipt.tripId === tripId) ||
      !tripGate(currentTrip, states).ready
    )
      throw new Error("Trip not ready");
    const prefix = readyKey(userId, snapshot, tripId);
    await assertAvailable(repository, prefix);
    await repository.enqueueBatch(
      [
        {
          type: "TRIP_READY",
          actor: { userId, role: "LOADER" },
          subject: { tripId, vehicleId: currentTrip.vehicleId },
          payload: { tripId },
        },
      ],
      {
        id: `${prefix}:${uuidv7()}`,
        userId,
        resetEpoch: snapshot.resetEpoch,
        date: snapshot.scope.date,
        tripId,
        kind: "TRIP_READY",
        planVersion: snapshot.planVersion!,
      },
    );
  });
}
