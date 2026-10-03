import { apiSchemas, type ClientEvent } from "@nextdrop/contracts";
import { create } from "zustand";
import { uuidv7 } from "uuidv7";
import { ApiRequestError, API_MOCK } from "../lib/api";
import { currentSession, isReauthNeeded } from "../lib/session";
import { isFieldRole } from "../lib/fieldRoles";
import { serverNowMs } from "../lib/clock";
import { type FieldRepository, fieldRepository } from "./repository";
import { syncTransport, type SyncTransport } from "./transport";

export const useSyncActivity = create<{ syncing: boolean; offline: boolean; error: string | null }>(() => ({
  syncing: false,
  offline: false,
  error: null,
}));
export function serviceDate(now = serverNowMs()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export class SyncController {
  private active: Promise<void> | null = null;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopListening: (() => void) | null = null;
  private failures = 0;
  private stream: EventSource | null = null;
  private leaseToken: string | null = null;
  constructor(
    readonly repository: FieldRepository = fieldRepository,
    readonly transport: SyncTransport = syncTransport,
    private identity: () => string | null = () => {
      const user = currentSession()?.user;
      return user && isFieldRole(user.role) ? user.id : null;
    },
    private paused: () => boolean = isReauthNeeded,
  ) {}

  private async canSync(userId: string): Promise<boolean> {
    const offline =
      (typeof navigator !== "undefined" && navigator.onLine === false) ||
      !!(await this.repository.db.value("simulateOffline"));
    useSyncActivity.setState({ offline });
    const ownsLease =
      !this.leaseToken || (await this.repository.db.value<{ token: string }>("syncLease"))?.token === this.leaseToken;
    return ownsLease && !offline && !this.paused() && this.identity() === userId;
  }

  /** All foreground triggers share one flight. A write during it requests another pass. */
  syncNow(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.run().finally(() => {
      this.active = null;
      if (this.rerun) {
        this.rerun = false;
        void this.syncNow();
      }
    });
    return this.active;
  }

  private async run(): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(`nextdrop-sync:${this.repository.db.name}`, { ifAvailable: true }, async (lock) => {
        if (lock) await this.runOwned();
      });
      this.schedule();
      return;
    }
    // IndexedDB lease fallback for browsers without Web Locks. Renew while owning the queue.
    const db = this.repository.db;
    const token = uuidv7();
    const lease = { token, until: Date.now() + 120000 };
    const acquired = await db.transaction("rw", db.meta, async () => {
      const current = await db.value<{ token: string; until: number }>("syncLease");
      if (current && current.until > Date.now()) return false;
      await db.set("syncLease", lease);
      return true;
    });
    if (!acquired) {
      this.schedule();
      return;
    }
    this.leaseToken = token;
    const renew = setInterval(() => {
      void db.transaction("rw", db.meta, async () => {
        if ((await db.value<{ token: string }>("syncLease"))?.token === token)
          await db.set("syncLease", { token, until: Date.now() + 120000 });
      });
    }, 30000);
    try {
      await this.runOwned();
    } finally {
      clearInterval(renew);
      this.leaseToken = null;
      await db.transaction("rw", db.meta, async () => {
        if ((await db.value<{ token: string }>("syncLease"))?.token === token) await db.meta.delete("syncLease");
      });
    }
  }

  private async runOwned(): Promise<void> {
    const userId = this.identity();
    if (!userId || !(await this.canSync(userId))) {
      this.stream?.close();
      this.stream = null;
      return;
    }
    useSyncActivity.setState({ syncing: true, error: null });
    const db = this.repository.db;
    try {
      // Recover sends interrupted by a tab close. Idempotent IDs make retries safe.
      await db.transaction("rw", db.outbox, db.blobQueue, async () => {
        for (const entry of await db.outbox.where("state").equals("sending").toArray()) {
          if (entry.actor.userId === userId) await db.outbox.update(entry.clientEventId, { state: "pending" });
        }
        for (const blob of await db.blobQueue.where("state").equals("sending").toArray()) {
          if (blob.userId === userId) await db.blobQueue.update(blob.clientBlobId, { state: "pending" });
        }
      });
      // Pull epoch before replaying old facts; reset must not push a stale outbox.
      await this.pull(userId);
      while (await this.canSync(userId)) {
        const candidates = (await db.outbox.orderBy("deviceSeq").toArray()).filter(
          (e) => e.state === "pending" && e.actor.userId === userId,
        );
        if (!candidates.length) break;
        const batch = [] as typeof candidates;
        const deviceId = candidates[0]!.deviceId;
        let events: ClientEvent[] = [];
        for (const entry of candidates.slice(0, 100)) {
          const {
            state: _state,
            attempts: _attempts,
            lastError: _error,
            blobRefs: _refs,
            confirmedAt: _confirmed,
            ...event
          } = entry;
          const next = [...events, event as ClientEvent];
          if (new TextEncoder().encode(JSON.stringify({ deviceId, events: next })).byteLength > 1000000) break;
          batch.push(entry);
          events = next;
        }
        if (!batch.length) {
          await db.outbox.update(candidates[0]!.clientEventId, { lastError: "PAYLOAD_TOO_LARGE" });
          throw new Error("An event exceeds the transport limit");
        }
        await db.transaction("rw", db.outbox, async () => {
          for (const e of batch)
            await db.outbox.update(e.clientEventId, { state: "sending", attempts: e.attempts + 1 });
        });
        try {
          const response = await this.transport.push(deviceId, events);
          if (this.identity() !== userId) return;
          const confirmed = new Set<string>();
          await db.transaction("rw", db.outbox, db.conflictsLocal, async () => {
            for (const result of response.results) {
              const match =
                result.status === "REJECTED"
                  ? batch[result.index]
                  : batch.find((e) => e.clientEventId === result.clientEventId);
              if (
                !match ||
                (result.clientEventId !== null && result.clientEventId !== match.clientEventId) ||
                confirmed.has(match.clientEventId)
              )
                continue;
              confirmed.add(match.clientEventId);
              await db.outbox.update(match.clientEventId, {
                state: result.status === "REJECTED" ? "failed" : result.status === "HELD_CONFLICT" ? "held" : "acked",
                lastError: result.code ?? null,
                confirmedAt: result.receivedAt,
              });
              if (result.status === "HELD_CONFLICT")
                await db.conflictsLocal.put({ id: result.conflictId, clientEventId: match.clientEventId, userId });
            }
            for (const e of batch)
              if (!confirmed.has(e.clientEventId))
                await db.outbox.update(e.clientEventId, { state: "pending", lastError: "MISSING_CONFIRMATION" });
          });
          if (confirmed.size !== batch.length) throw new Error("Incomplete server confirmation");
        } catch (error) {
          await db.transaction("rw", db.outbox, async () => {
            for (const e of batch) {
              const row = await db.outbox.get(e.clientEventId);
              if (row?.state === "sending")
                await db.outbox.update(e.clientEventId, { state: "pending", lastError: "TRANSPORT_FAILED" });
            }
          });
          throw error;
        }
        // Refresh authoritative state after acknowledgements even if a feed hint has not arrived.
        await this.fetchSnapshot(userId);
      }
      if (!(await this.canSync(userId))) return;
      // Text queue completes before any evidence upload starts.
      for (const blob of await db.blobQueue.where("state").equals("pending").toArray()) {
        if (blob.userId !== userId || !(await this.canSync(userId))) continue;
        await db.blobQueue.update(blob.clientBlobId, { state: "sending", attempts: blob.attempts + 1 });
        try {
          await this.transport.upload(blob);
          await db.blobQueue.update(blob.clientBlobId, { state: "acked", lastError: null });
        } catch (error) {
          const terminal =
            error instanceof ApiRequestError &&
            error.status !== null &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 401 &&
            error.status !== 429;
          await db.blobQueue.update(blob.clientBlobId, {
            state: terminal ? "failed" : "pending",
            lastError: terminal ? (error.code ?? "UPLOAD_REJECTED") : "TRANSPORT_FAILED",
          });
          throw error;
        }
      }
      await db.set("lastSyncedAt", new Date(serverNowMs()).toISOString());
      this.failures = 0;
      await this.openStream();
    } catch (error) {
      this.failures++;
      useSyncActivity.setState({ error: error instanceof Error ? error.message : "Sync failed" });
    } finally {
      useSyncActivity.setState({ syncing: false });
      this.schedule();
    }
  }

  private async fetchSnapshot(userId: string): Promise<void> {
    if (!(await this.canSync(userId))) return;
    const snapshot = await this.transport.snapshot(serviceDate());
    if (this.identity() === userId) await this.repository.replaceSnapshot(snapshot, userId);
  }

  private async pull(userId: string): Promise<void> {
    const db = this.repository.db;
    if ((await db.value("snapshotOwner")) !== userId || !(await db.runs.get("current")))
      await this.fetchSnapshot(userId);
    let after = (await db.value<string>("feedCursor")) ?? "0";
    const limit = 100;
    let changed = false;
    const resolvedConflicts: string[] = [];
    while (await this.canSync(userId)) {
      const response = await this.transport.changes(after, limit);
      if (this.identity() !== userId) return;
      if (await this.repository.observeEpoch(response.resetEpoch)) {
        await this.fetchSnapshot(userId);
        return;
      }
      changed ||= response.items.length > 0;
      resolvedConflicts.push(
        ...response.items.filter((item) => item.kind === "conflict_resolved").map((item) => item.entity.id),
      );
      // No visible rows still advances to head. Never convert a cursor to Number.
      if (BigInt(response.head) < BigInt(after)) throw new Error("Regressing change-feed cursor");
      after = response.items.length === limit ? response.items.at(-1)!.seq : response.head;
      if (response.items.length < limit) {
        if (changed) await this.fetchSnapshot(userId);
        else await db.set("feedCursor", after);
        await db.transaction("rw", db.conflictsLocal, db.outbox, async () => {
          for (const id of resolvedConflicts) {
            const conflict = await db.conflictsLocal.get(id);
            if (conflict?.userId !== userId) continue;
            await db.outbox.update(conflict.clientEventId, { state: "acked" });
            await db.conflictsLocal.delete(id);
          }
        });
        return;
      }
    }
  }

  private async openStream(): Promise<void> {
    if (!this.stopListening || this.stream || API_MOCK || typeof EventSource === "undefined") return;
    const cursor = (await this.repository.db.value<string>("feedCursor")) ?? "0";
    if (this.stream || this.paused()) return;
    this.stream = new EventSource(`/api/stream?after=${encodeURIComponent(cursor)}`);
    this.stream.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const hint = apiSchemas.streamHint.safeParse(raw);
      if (!hint.success) return;
      void this.repository.db.value<string>("feedCursor").then((cursor) => {
        if (BigInt(hint.data.head) > BigInt(cursor ?? "0")) void this.syncNow();
        else
          void this.repository.db.value<number>("resetEpoch").then((epoch) => {
            if (epoch !== hint.data.resetEpoch) void this.syncNow();
          });
      });
    };
    this.stream.onerror = () => {
      this.stream?.close();
      this.stream = null;
    };
  }

  private schedule(): void {
    if (!this.stopListening) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = this.failures
      ? Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5)) * (0.75 + Math.random() * 0.5)
      : 20000 + Math.random() * 5000;
    this.timer = setTimeout(() => void this.syncNow(), delay);
  }

  start(): () => void {
    if (this.stopListening) return this.stopListening;
    const online = () => void this.syncNow();
    const visible = () => {
      if (document.visibilityState === "visible") void this.syncNow();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    document.addEventListener("visibilitychange", visible);
    this.repository.onWrite = () => {
      if (this.active) this.rerun = true;
      else online();
    };
    this.stopListening = () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      document.removeEventListener("visibilitychange", visible);
      this.repository.onWrite = null;
      if (this.timer) clearTimeout(this.timer);
      this.stream?.close();
      this.stream = null;
      this.stopListening = null;
    };
    void navigator.storage?.persist?.().catch(() => false);
    void this.syncNow();
    return this.stopListening;
  }
}
export const syncController = new SyncController();
