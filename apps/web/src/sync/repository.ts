import { clientEventSchema, SCHEMA_VERSION, type ClientEvent, type FieldSnapshot } from "@nextdrop/contracts";
import { applyEvent, emptyOrderState, type OrderEvent, type OrderState } from "@nextdrop/rules";
import { uuidv7 } from "uuidv7";
import { clockOffsetMs } from "../lib/clock";
import { setDemoNotice } from "../lib/demo";
import { offlineDb, type OfflineDatabase, type OutboxEntry } from "./database";

export type EventIntent = ClientEvent extends infer Event
  ? Event extends ClientEvent
    ? Pick<Event, "type" | "payload" | "subject" | "actor"> & { blobRefs?: string[] }
    : never
  : never;
export const unconfirmed = (entry: OutboxEntry) => entry.state === "pending" || entry.state === "sending";

export class FieldRepository {
  onWrite: (() => void) | null = null;
  constructor(readonly db: OfflineDatabase = offlineDb) {}

  async enqueue(intent: EventIntent): Promise<OutboxEntry> {
    const entry = await this.db.transaction("rw", this.db.meta, this.db.outbox, async () => {
      const deviceId = await this.db.value<string>("deviceId");
      if (!deviceId) throw new Error("Device must be initialized before recording work");
      const deviceSeq = (await this.db.value<number>("deviceSeq")) ?? 0;
      const event = clientEventSchema.parse({
        type: intent.type,
        payload: intent.payload,
        subject: intent.subject,
        actor: intent.actor,
        clientEventId: uuidv7(),
        deviceId,
        deviceSeq,
        source: "FIELD",
        schemaVersion: SCHEMA_VERSION,
        capturedAt: new Date().toISOString(),
        clockOffsetMs: clockOffsetMs(),
        basedOnPlanVersion: (await this.db.value<number | null>("planVersion")) ?? undefined,
      });
      if (new TextEncoder().encode(JSON.stringify({ deviceId, events: [event] })).byteLength > 1000000)
        throw new Error("Event exceeds the transport limit");
      const row: OutboxEntry = {
        ...event,
        state: "pending",
        attempts: 0,
        lastError: null,
        blobRefs: intent.blobRefs ?? [],
      };
      await this.db.outbox.add(row);
      await this.db.set("deviceSeq", deviceSeq + 1);
      return row;
    });
    this.onWrite?.();
    return entry;
  }

  /** Reset is the only snapshot operation allowed to discard queued work (ADR 0007). */
  async observeEpoch(epoch: number): Promise<boolean> {
    let reset = false;
    await this.db.transaction("rw", this.db.tables, async () => {
      const previous = await this.db.value<number>("resetEpoch");
      if (previous !== undefined && previous !== epoch) {
        reset = true;
        for (const table of this.db.tables) if (table.name !== "meta") await table.clear();
        for (const key of ["feedCursor", "planVersion", "lastSyncedAt", "snapshotOwner"])
          await this.db.meta.delete(key);
        await this.db.set("resetNotice", { resetEpoch: epoch, lastResetBy: null, lastResetAt: null });
      }
      await this.db.set("resetEpoch", epoch);
    });
    if (reset) setDemoNotice({ resetEpoch: epoch, lastResetBy: null, lastResetAt: null });
    return reset;
  }

  async replaceSnapshot(snapshot: FieldSnapshot, userId: string): Promise<void> {
    await this.db.transaction("rw", this.db.tables, async () => {
      await this.observeEpoch(snapshot.resetEpoch);
      for (const table of [
        this.db.runs,
        this.db.trips,
        this.db.stops,
        this.db.orders,
        this.db.outlets,
        this.db.contacts,
      ])
        await table.clear();
      await this.db.runs.put({ id: "current", snapshot });
      await this.db.trips.bulkPut(snapshot.scope.trips);
      for (const trip of snapshot.scope.trips)
        for (const stop of trip.stops) {
          await this.db.stops.put(stop);
          await this.db.orders.put(stop.order);
          await this.db.outlets.put(stop.outlet);
          if (stop.outlet.contact) await this.db.contacts.put({ id: stop.outlet.id, contact: stop.outlet.contact });
        }
      if (snapshot.role === "LOADER") await this.db.orders.bulkPut(snapshot.scope.reversals);
      await this.db.set("snapshotOwner", userId);
      await this.db.set("planVersion", snapshot.planVersion);
      await this.db.set("feedCursor", snapshot.feedCursor);
    });
  }

  async snapshot(userId: string): Promise<FieldSnapshot | null> {
    return this.db.transaction("r", this.db.meta, this.db.runs, async () => {
      if ((await this.db.value("snapshotOwner")) !== userId) return null;
      return (await this.db.runs.get("current"))?.snapshot ?? null;
    });
  }

  async projectOrder(orderId: string, userId: string): Promise<OrderState | null> {
    return this.db.transaction("r", this.db.orders, this.db.outbox, this.db.meta, async () => {
      if ((await this.db.value("snapshotOwner")) !== userId) return null;
      const order = await this.db.orders.get(orderId);
      if (!order) return null;
      const version = (await this.db.value<number>("planVersion")) ?? 0;
      let state: OrderState = {
        ...emptyOrderState(orderId),
        status: order.status,
        deferralCount: order.deferredCount,
        assignment: order.assignment ? { ...order.assignment, planVersion: version } : null,
        short: order.flags.short.map((line) => ({ ...line, resolution: line.resolution ?? null })),
        damaged: order.flags.damaged,
        pendingReversal: order.pendingReversal ? { ...order.pendingReversal, next: null } : null,
      };
      const events = await this.db.outbox.orderBy("deviceSeq").toArray();
      for (const event of events) {
        if (!unconfirmed(event) || event.actor.userId !== userId) continue;
        if (
          event.subject.orderId !== orderId &&
          !(
            event.type === "TRIP_DEPARTED" &&
            (event.subject.tripId ?? event.payload.tripId) === state.assignment?.tripId
          )
        )
          continue;
        state = applyEvent(state, { ...event, id: event.clientEventId } as OrderEvent).state;
      }
      return state;
    });
  }
}
export const fieldRepository = new FieldRepository();
