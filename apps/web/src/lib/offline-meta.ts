import { offlineDb } from "../sync/database";

/** Authentication and preferences remain usable when offline storage cannot open. */
export async function optionalMeta<T>(key: string): Promise<T | undefined> {
  try {
    return await offlineDb.value<T>(key);
  } catch {
    return undefined;
  }
}

/** Best effort for session/preferences only. Durable field writes never use this fallback. */
export async function persistOptional(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    /* Storage failure disables persistence, not online authentication. */
  }
}
