import { apiRoutes, type ClientEvent } from "@nextdrop/contracts";
import type { OutboxEntry } from "./database";

export function clientEvent(entry: OutboxEntry): ClientEvent {
  const {
    state: _state,
    attempts: _attempts,
    lastError: _error,
    blobRefs: _refs,
    confirmedAt: _confirmed,
    confirmationFeedHead: _head,
    ...event
  } = entry;
  return event as ClientEvent;
}

/** UTF-8 size = empty envelope + each event + separating commas; encode each event just once. */
export function eventBatch(candidates: OutboxEntry[]) {
  const rows: OutboxEntry[] = [];
  const events: ClientEvent[] = [];
  const deviceId = candidates[0]?.deviceId ?? "";
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify({ deviceId, events: [] })).byteLength;
  for (const entry of candidates.slice(0, 100)) {
    const event = clientEvent(entry);
    const nextBytes = encoder.encode(JSON.stringify(event)).byteLength + (rows.length ? 1 : 0);
    if (bytes + nextBytes > apiRoutes.syncEvents.bodyLimit) break;
    bytes += nextBytes;
    rows.push(entry);
    events.push(event);
  }
  return { rows, events, deviceId, bytes };
}
