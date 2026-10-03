import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

it("keeps a stable device ID when IndexedDB fails and persists it on recovery", async () => {
  vi.resetModules();
  const { offlineDb } = await import("../sync/database");
  const { initializeDevice, getDeviceId } = await import("./device");
  await offlineDb.meta.delete("deviceId");
  const transaction = vi.spyOn(offlineDb, "transaction").mockRejectedValue(new Error("Blocked storage"));
  const id = await initializeDevice();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(getDeviceId()).toBe(id);
  expect(await initializeDevice()).toBe(id);
  transaction.mockRestore();
  expect(await initializeDevice()).toBe(id);
  expect(await offlineDb.value("deviceId")).toBe(id);
  offlineDb.close();
});
