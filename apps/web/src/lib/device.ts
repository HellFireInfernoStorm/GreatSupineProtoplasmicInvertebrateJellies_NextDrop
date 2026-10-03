import { uuidv7 } from "uuidv7";
import { offlineDb } from "../sync/database";
import { readStored, writeStored } from "./storage";

let initialized: Promise<string> | null = null;
let deviceId: string | null = null;

/** Hydrate before the first route loader/login. Migrate the old browser ID without changing its identity. */
export function initializeDevice(): Promise<string> {
  initialized ??= offlineDb
    .transaction("rw", offlineDb.meta, async () => {
      const stored = await offlineDb.value<string>("deviceId");
      const legacy = readStored("nextdrop.deviceId");
      const id = stored ?? legacy ?? uuidv7();
      await offlineDb.set("deviceId", id);
      return id;
    })
    .then((id) => {
      deviceId = id;
      writeStored("nextdrop.deviceId", null);
      return id;
    })
    .catch((error) => {
      initialized = null;
      throw error;
    });
  return initialized;
}

export function getDeviceId(): string {
  if (!deviceId) throw new Error("Device identity has not been initialized");
  return deviceId;
}
