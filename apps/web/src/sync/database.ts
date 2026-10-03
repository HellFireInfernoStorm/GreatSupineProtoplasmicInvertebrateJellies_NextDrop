import Dexie, { type EntityTable } from "dexie";
import type { ApiDto, ClientEvent, FieldSnapshot, OrderDto, TripDto } from "@nextdrop/contracts";

export type OutboxState = "pending" | "sending" | "acked" | "held" | "rejected" | "failed";
export type OutboxEntry = ClientEvent & {
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  blobRefs: string[];
  confirmedAt?: string;
};
export interface QueuedBlob {
  clientBlobId: string;
  userId: string;
  bytes: Blob;
  state: "pending" | "sending" | "acked" | "failed";
  attempts: number;
  lastError: string | null;
}
export interface Metadata {
  key: string;
  value: unknown;
}
export class OfflineDatabase extends Dexie {
  outbox!: EntityTable<OutboxEntry, "clientEventId">;
  blobQueue!: EntityTable<QueuedBlob, "clientBlobId">;
  runs!: EntityTable<{ id: string; snapshot: FieldSnapshot }, "id">;
  trips!: EntityTable<TripDto, "id">;
  stops!: EntityTable<ApiDto<"stop">, "id">;
  orders!: EntityTable<OrderDto, "id">;
  outlets!: EntityTable<ApiDto<"outlet">, "id">;
  contacts!: EntityTable<{ id: string; contact: ApiDto<"contact"> }, "id">;
  conflictsLocal!: EntityTable<{ id: string; clientEventId: string; userId: string }, "id">;
  meta!: EntityTable<Metadata, "key">;

  constructor(name = "nextdrop-field") {
    super(name);
    this.version(1).stores({
      outbox: "clientEventId, deviceSeq, state, actor.userId",
      blobQueue: "clientBlobId, state, userId",
      runs: "id",
      trips: "id",
      stops: "id",
      orders: "id",
      outlets: "id",
      contacts: "id",
      conflictsLocal: "id, userId",
      meta: "key",
    });
  }

  async value<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}
export const offlineDb = new OfflineDatabase();
