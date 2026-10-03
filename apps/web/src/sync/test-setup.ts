import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { offlineDb } from "./database";
import { initializeDevice } from "../lib/device";

beforeEach(async () => {
  const deviceId = await initializeDevice();
  await offlineDb.transaction("rw", offlineDb.tables, async () => {
    for (const table of offlineDb.tables) await table.clear();
    await offlineDb.set("deviceId", deviceId);
  });
});
