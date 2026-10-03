import { uuidv7 } from "uuidv7";
import { readStored, writeStored } from "./storage";

const DEVICE_ID_KEY = "nextdrop.deviceId";
let memoryDeviceId: string | null = null;

/**
 * The stable ID of this browser, sent with field logins and field events. It is created once and kept.
 *
 * If storage is blocked the ID lasts only until the page reloads. The server ties a field session to its device
 * ID, so after a reload a PIN reauth is refused and the user gets the full login. The offline core (#40) moves
 * the ID into Dexie next to the outbox.
 */
export function getDeviceId(): string {
  const stored = readStored(DEVICE_ID_KEY) ?? memoryDeviceId;
  if (stored) return stored;
  const created = uuidv7();
  memoryDeviceId = created;
  writeStored(DEVICE_ID_KEY, created);
  return created;
}
