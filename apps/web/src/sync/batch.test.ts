import { apiFixtures, apiRoutes } from "@nextdrop/contracts";
import { expect, it } from "vitest";
import { eventBatch } from "./batch";
import type { OutboxEntry } from "./database";

const entry = (): OutboxEntry => ({
  ...apiFixtures.clientEvent,
  state: "pending",
  attempts: 4,
  lastError: null,
  blobRefs: [],
  confirmedAt: "old",
  confirmationFeedHead: "1",
});

it("counts the exact UTF-8 envelope including escaped text and commas without local metadata", () => {
  const first = entry();
  first.actor.userId = 'සිංහල தமிழ் \\ "';
  const batch = eventBatch([first, entry(), entry()]);
  expect(batch.bytes).toBe(
    new TextEncoder().encode(JSON.stringify({ deviceId: batch.deviceId, events: batch.events })).byteLength,
  );
  expect(batch.events[0]).not.toHaveProperty("confirmationFeedHead");
  expect(batch.events[0]).not.toHaveProperty("state");
});

it("caps the byte limit from contracts and stops at 100 events", () => {
  expect(eventBatch(Array.from({ length: 101 }, entry)).rows).toHaveLength(100);
  const large = entry();
  large.actor.userId = "界".repeat(apiRoutes.syncEvents.bodyLimit);
  expect(eventBatch([large]).rows).toHaveLength(0);
  const medium = entry();
  medium.actor.userId = "界".repeat(Math.floor(apiRoutes.syncEvents.bodyLimit / 9));
  const batch = eventBatch(Array.from({ length: 10 }, () => medium));
  expect(batch.rows.length).toBeGreaterThan(0);
  expect(batch.rows.length).toBeLessThan(10);
  expect(batch.bytes).toBeLessThanOrEqual(apiRoutes.syncEvents.bodyLimit);
});
