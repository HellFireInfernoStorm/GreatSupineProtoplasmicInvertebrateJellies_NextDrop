import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { apiVariantFixtures, type FieldSnapshot } from "@nextdrop/contracts";
import { uuidv7 } from "uuidv7";
import { OfflineDatabase, type FieldReceipt } from "../../sync/database";
import { FieldRepository } from "../../sync/repository";
import { loadIntents, loadOrder, tripGate, projectDrafts, loadTotals, latestReceipt, canRetry } from "./model";
import { loadKey, saveDraft, undoDraft, promoteDraft, queueReady, readyKey } from "./drafts";
import { Checklist } from "./Checklist";
import { Ready } from "./Ready";
import type { LoaderData } from "./data";
import type * as LoaderParts from "./parts";
import type * as SessionModule from "../../lib/session";
import "../../i18n";
vi.mock("../../lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  useSession: () => ({ user: { id: "loader-1" } }),
}));
vi.mock("./parts", async (importOriginal) => ({
  ...(await importOriginal<typeof LoaderParts>()),
  Frame: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) =>
    createElement("main", null, children, footer),
}));
let db: OfflineDatabase;
let repository: FieldRepository;
const userId = "loader-1";
const snapshot = (): Extract<FieldSnapshot, { role: "LOADER" }> => {
  const value = structuredClone(apiVariantFixtures.fieldSnapshot.LOADER);
  const order = value.scope.trips[0]!.stops[0]!.order;
  order.status = "PLANNED";
  order.lines[0]!.qtyOrdered = 10;
  order.lines[0]!.qtyLoaded = 0;
  order.flags.short = [];
  order.flags.damaged = [];
  value.scope.trips[0]!.status = "PLANNED";
  return value;
};
beforeEach(async () => {
  db = new OfflineDatabase(`loader-${uuidv7()}`);
  repository = new FieldRepository(db);
  await db.set("deviceId", uuidv7());
});
afterEach(async () => {
  await db.delete();
});
async function stage(kind: "loaded" | "short" | "damaged", quantity = 0) {
  const value = snapshot();
  await repository.replaceSnapshot(value, userId);
  const trip = value.scope.trips[0]!;
  const stop = trip.stops[0]!;
  const line = stop.order.lines[0]!;
  const state = (await repository.projectOrder(stop.order.id, userId))!;
  const photoRef = uuidv7();
  const intents = loadIntents({
    trip,
    stop,
    line,
    state,
    userId,
    kind,
    quantity,
    reason: kind === "short" ? "STOCK_SHORT" : "CRUSHED",
    photoRef: kind === "damaged" ? photoRef : undefined,
  });
  const draft = await saveDraft(
    repository,
    {
      label: line.name,
      receipt: {
        id: loadKey(userId, value, stop.order.id, line.id),
        userId,
        resetEpoch: value.resetEpoch,
        date: value.scope.date,
        tripId: trip.id,
        orderId: stop.order.id,
        kind: "LOAD",
        planVersion: value.planVersion!,
      },
      intents,
      capturedAt: "2026-09-29T00:10:00Z",
      clockOffsetMs: 60000,
      ...(kind === "damaged"
        ? {
            blob: {
              clientBlobId: photoRef,
              userId,
              bytes: new Blob(["photo"]),
              state: "pending" as const,
              attempts: 0,
              lastError: null,
            },
          }
        : {}),
    },
    1000,
  );
  return { draft, trip, stop, value, state };
}
describe("Loader durable recording", () => {
  it("restores the actual checklist and hand-over controls after a rejected attempt", async () => {
    const { draft, value, trip, stop } = await stage("loaded");
    await promoteDraft(repository, draft.key, userId, 7000);
    await db.outbox.toCollection().modify({ state: "held" });
    const data: LoaderData = {
      snapshot: value,
      states: { [stop.order.id]: (await repository.projectOrder(stop.order.id, userId))! },
      events: await db.outbox.toArray(),
      receipts: [(await db.value<FieldReceipt>(`fieldReceipt:${draft.receipt.id}`))!],
      blobs: [],
      drafts: [],
      baseline: value.planVersion,
      loaded: true,
      error: false,
    };
    const render = (component: typeof Checklist | typeof Ready, path: string) =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: [`/loader/trips/${trip.id}${path}`] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: `/loader/trips/:tripId${path}`, element: createElement(component, { data }) }),
          ),
        ),
      );
    const button = (html: string, text: string) =>
      [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find((match) => match[0].includes(text))?.[0];
    expect(button(render(Checklist, ""), ">Loaded<")).toContain("disabled");
    await db.outbox.toCollection().modify({ state: "rejected" });
    data.events = await db.outbox.toArray();
    expect(button(render(Checklist, ""), ">Loaded<")).not.toContain("disabled");
    expect(render(Checklist, "")).toContain("Not accepted · check connection details");
    stop.order.lines[0]!.qtyLoaded = 10;
    await repository.replaceSnapshot(value, userId);
    await queueReady(repository, userId, value, trip.id);
    const rows = await db.meta.where("key").startsWith("fieldReceipt:").toArray();
    data.receipts = rows.map((r) => r.value as FieldReceipt);
    data.events = await db.outbox.toArray();
    data.states[stop.order.id] = (await repository.projectOrder(stop.order.id, userId))!;
    expect(button(render(Ready, "/ready"), "nd-hold")).toBeUndefined();
    await db.outbox
      .toCollection()
      .filter((e) => e.type === "TRIP_READY")
      .modify({ state: "rejected" });
    data.events = await db.outbox.toArray();
    expect(button(render(Ready, "/ready"), "nd-hold")).toBeDefined();
    expect(button(render(Ready, "/ready"), "nd-hold")).not.toContain("disabled");
  });
  it.each(["rejected", "failed"] as const)(
    "allows a new load attempt after %s while preserving its history",
    async (state) => {
      const { draft, value, stop } = await stage("loaded");
      const prefix = loadKey(userId, value, stop.order.id, stop.order.lines[0]!.id);
      await promoteDraft(repository, draft.key, userId, 7000);
      await db.outbox.toCollection().modify({ state });
      const oldReceipt = (await db.value<FieldReceipt>(`fieldReceipt:${draft.receipt.id}`))!;
      expect(canRetry(oldReceipt, await db.outbox.toArray())).toBe(true);
      expect((await repository.projectOrder(stop.order.id, userId))!.loaded[0]!.qtyLoaded).toBe(0);
      const retryInput = { ...draft, receipt: { ...draft.receipt, id: prefix } };
      const retry = await saveDraft(repository, retryInput, 8000);
      expect(retry.receipt.id).not.toBe(draft.receipt.id);
      await expect(saveDraft(repository, retryInput, 8001)).rejects.toThrow("Already recorded");
      await promoteDraft(repository, retry.key, userId, 14000);
      const rows = await db.meta.where("key").startsWith("fieldReceipt:").toArray();
      const receipts = rows.map((r) => r.value as FieldReceipt);
      expect(receipts).toHaveLength(2);
      expect(latestReceipt(receipts, prefix)?.id).toBe(retry.receipt.id);
      expect(canRetry(latestReceipt(receipts, prefix)!, await db.outbox.toArray())).toBe(false);
      expect((await repository.projectOrder(stop.order.id, userId))!.loaded[0]!.qtyLoaded).toBe(10);
      expect(
        (await db.outbox.toArray()).find((e) => e.clientEventId === oldReceipt.events[0]!.clientEventId)?.state,
      ).toBe(state);
    },
  );
  it.each(["rejected", "failed"] as const)(
    "allows another hand-over after %s but prevents two live attempts",
    async (state) => {
      const { draft, value, trip } = await stage("loaded");
      await promoteDraft(repository, draft.key, userId, 7000);
      await queueReady(repository, userId, value, trip.id);
      await db.outbox
        .where("state")
        .equals("pending")
        .filter((e) => e.type === "TRIP_READY")
        .modify({ state });
      await queueReady(repository, userId, value, trip.id);
      await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Already recorded");
      const events = (await db.outbox.toArray()).filter((e) => e.type === "TRIP_READY");
      expect(events.map((e) => e.state)).toEqual([state, "pending"]);
      const receipts = (await db.meta.where("key").startsWith("fieldReceipt:").toArray()).map(
        (r) => r.value as FieldReceipt,
      );
      expect(latestReceipt(receipts, readyKey(userId, value, trip.id))?.events[0]!.clientEventId).toBe(
        events[1]!.clientEventId,
      );
    },
  );
  it("keeps partial and held batches locked and recognizes legacy receipts", async () => {
    const { draft, value, stop } = await stage("short", 2);
    await promoteDraft(repository, draft.key, userId, 7000);
    const prefix = loadKey(userId, value, stop.order.id, stop.order.lines[0]!.id);
    const original = (await db.value<FieldReceipt>(`fieldReceipt:${draft.receipt.id}`))!;
    await db.meta.delete(`fieldReceipt:${draft.receipt.id}`);
    await db.set(`fieldReceipt:${prefix}`, { ...original, id: prefix });
    const receipt = { ...original, id: prefix };
    for (const state of ["pending", "sending", "held", "acked"] as const) {
      await db.outbox.toCollection().modify({ state: "rejected" });
      await db.outbox.update(original.events[0]!.clientEventId, { state });
      expect(canRetry(receipt, await db.outbox.toArray())).toBe(false);
      await expect(
        saveDraft(repository, { ...draft, receipt: { ...draft.receipt, id: prefix } }, 8000),
      ).rejects.toThrow("Already recorded");
    }
    expect(latestReceipt([receipt], prefix)?.id).toBe(prefix);
  });
  it("hand-over rechecks saved quantities and drafts, then records exactly one durable ready receipt", async () => {
    const { draft, value, trip } = await stage("loaded");
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Trip not ready");
    expect(await db.outbox.count()).toBe(0);
    await promoteDraft(repository, draft.key, userId, 7000);
    await queueReady(repository, userId, value, trip.id);
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Already recorded");
    const events = await db.outbox.toArray();
    expect(events.filter((e) => e.type === "TRIP_READY")).toHaveLength(1);
    expect(events.find((e) => e.type === "TRIP_READY")?.subject).toEqual({
      tripId: trip.id,
      vehicleId: trip.vehicleId,
    });
    expect(
      latestReceipt(
        (await db.meta.where("key").startsWith("fieldReceipt:").toArray()).map((r) => r.value as FieldReceipt),
        readyKey(userId, value, trip.id),
      ),
    ).toBeDefined();
  });
  it("hand-over rejects stale plans, other owners and unresolved shorts without recording a ready fact", async () => {
    const { draft, value, trip, stop } = await stage("short", 2);
    await promoteDraft(repository, draft.key, userId, 7000);
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Trip not ready");
    await expect(queueReady(repository, "another-loader", value, trip.id)).rejects.toThrow("Trip changed");
    stop.order.flags.short = [{ lineId: stop.order.lines[0]!.id, qtyShort: 2, resolution: "SHIP_PARTIAL" }];
    stop.order.lines[0]!.qtyLoaded = 8;
    await repository.replaceSnapshot({ ...value, planVersion: 3 }, userId);
    await expect(queueReady(repository, userId, value, trip.id)).rejects.toThrow("Trip changed");
    expect((await db.outbox.toArray()).some((e) => e.type === "TRIP_READY")).toBe(false);
  });
  it("loads in reverse sequence, keeps snapshots intact, and blocks untouched lines", async () => {
    const value = snapshot();
    const trip = value.scope.trips[0]!;
    const second = structuredClone(trip.stops[0]!);
    second.id = uuidv7();
    second.seq = 8;
    trip.stops.push(second);
    expect(loadOrder(trip).map((s) => s.seq)).toEqual([8, trip.stops[0]!.seq]);
    expect(trip.stops[0]!.id).not.toBe(second.id);
    trip.stops.pop();
    await repository.replaceSnapshot(value, userId);
    const state = (await repository.projectOrder(trip.stops[0]!.order.id, userId))!;
    expect(tripGate(trip, { [state.orderId]: state }).ready).toBe(false);
    trip.stops[0]!.order.lines[0]!.qtyLoaded = 10;
    await repository.replaceSnapshot(value, userId);
    const saved = (await repository.projectOrder(state.orderId, userId))!;
    expect(tripGate(trip, { [state.orderId]: saved }).ready).toBe(true);
  });
  it("Undo removes only its unsent draft; promotion retains original capture time and rejects duplicate saves", async () => {
    const { draft, state, trip, value } = await stage("loaded");
    expect(tripGate(trip, { [state.orderId]: projectDrafts(state, [draft]) }).ready).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(await promoteDraft(repository, draft.key, userId, 5999)).toBe(false);
    expect(await undoDraft(repository, draft.key, "another-loader", 2000)).toBe(false);
    expect(await undoDraft(repository, draft.key, userId, 2000)).toBe(true);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(false);
    await db.set(draft.key, draft);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(true);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(false);
    const events = await db.outbox.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]!.capturedAt).toBe(draft.capturedAt);
    expect(events[0]!.clockOffsetMs).toBe(60000);
    expect(await undoDraft(repository, draft.key, userId, 7000)).toBe(false);
    await expect(
      saveDraft(
        repository,
        {
          ...draft,
          receipt: { ...draft.receipt, id: loadKey(userId, value, state.orderId, trip.stops[0]!.order.lines[0]!.id) },
        },
        8000,
      ),
    ).rejects.toThrow("Already recorded");
  });
  it("short reports confirm the remaining load but wait for dispatcher approval", async () => {
    const { draft, state, trip } = await stage("short", 4);
    const projected = projectDrafts(state, [draft]);
    const gate = tripGate(trip, { [state.orderId]: projected });
    expect(projected.loaded[0]!.qtyLoaded).toBe(6);
    expect(gate.incompleteLines).toHaveLength(0);
    expect(gate.ready).toBe(false);
    expect(loadTotals(trip, { [state.orderId]: projected }).short).toBe(4);
    await promoteDraft(repository, draft.key, userId, 7000);
    const current = (await repository.projectOrder(state.orderId, userId))!;
    expect(current.short).toHaveLength(1);
    const approved = { ...current, short: current.short.map((l) => ({ ...l, resolution: "SHIP_PARTIAL" as const })) };
    expect(tripGate(trip, { [state.orderId]: approved }).ready).toBe(true);
    const held = { ...current, short: current.short.map((l) => ({ ...l, resolution: "HOLD_TRIP" as const })) };
    expect(tripGate(trip, { [state.orderId]: held }).ready).toBe(false);
  });
  it("damage and photo promote atomically; held/rejected reports stay inert", async () => {
    const { draft, state, trip } = await stage("damaged", 2);
    expect(await db.blobQueue.count()).toBe(0);
    await promoteDraft(repository, draft.key, userId, 7000);
    const events = await db.outbox.toArray();
    expect(events.map((e) => e.type)).toEqual(["LOAD_DAMAGED", "LOAD_CONFIRMED"]);
    expect(await db.blobQueue.count()).toBe(1);
    expect(events[0]!.payload).toMatchObject({ reasonCode: "CRUSHED", photoRef: draft.blob!.clientBlobId });
    const recorded = (await repository.projectOrder(state.orderId, userId))!;
    expect(tripGate(trip, { [state.orderId]: recorded }).ready).toBe(true);
    await db.outbox.toCollection().modify({ state: "held" });
    const held = (await repository.projectOrder(state.orderId, userId))!;
    expect(held.damaged).toHaveLength(0);
    expect(tripGate(trip, { [state.orderId]: held }).ready).toBe(false);
  });
  it("cold resume promotes once, preserves stale-plan drafts and clears them on reset", async () => {
    const { draft, value } = await stage("loaded");
    const name = db.name;
    db.close();
    db = new OfflineDatabase(name);
    repository = new FieldRepository(db);
    await repository.replaceSnapshot({ ...value, planVersion: 3 }, userId);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(false);
    expect(await db.value(draft.key)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
    await repository.replaceSnapshot(value, userId);
    expect(await promoteDraft(repository, draft.key, userId, 7000)).toBe(true);
    await db.set(draft.key, draft);
    await db.set("loaderPlan:owner", 1);
    await repository.observeEpoch(value.resetEpoch + 1);
    expect(await db.value(draft.key)).toBeUndefined();
    expect(await db.value("loaderPlan:owner")).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
  it("snapshot coverage prunes receipts without doubling short flags or losing loaded totals", async () => {
    const { draft, value, stop, trip } = await stage("short", 4);
    await promoteDraft(repository, draft.key, userId, 7000);
    await db.outbox
      .toCollection()
      .modify({ state: "acked", confirmationFeedHead: "20", confirmedAt: "2026-09-29T01:00:00Z" });
    stop.order.flags.short = [{ lineId: stop.order.lines[0]!.id, qtyShort: 4, resolution: "SHIP_PARTIAL" }];
    stop.order.lines[0]!.qtyLoaded = 6;
    stop.order.status = "LOADED";
    await repository.replaceSnapshot({ ...value, feedCursor: "20" }, userId);
    expect(await db.outbox.count()).toBe(0);
    const projected = (await repository.projectOrder(stop.order.id, userId))!;
    expect(projected.short).toHaveLength(1);
    expect(projected.loaded[0]!.qtyLoaded).toBe(6);
    expect(tripGate(trip, { [projected.orderId]: projected }).ready).toBe(true);
    const receipt = await db.value<{ events: { state: string }[] }>(`fieldReceipt:${draft.receipt.id}`);
    expect(receipt?.events.every((e) => e.state === "acked")).toBe(true);
  });
});
