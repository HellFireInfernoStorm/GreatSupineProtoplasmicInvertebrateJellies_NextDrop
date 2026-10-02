import type { EventType } from "./event-types";
import { SCHEMA_VERSION } from "./schema-version";

export type PayloadUpcaster = (payload: unknown) => unknown;

/** Maps event type -> fromVersion -> upcaster to the next version. Empty for v1. */
export type UpcasterRegistry = Map<EventType, Map<number, PayloadUpcaster>>;

/** Shared registry. Register a v2 upcaster here when a payload changes. */
export const upcasterRegistry: UpcasterRegistry = new Map();

/** Walk from `schemaVersion` up to {@link SCHEMA_VERSION}, applying registered upcasters. */
export function upcastPayload(
  type: EventType,
  schemaVersion: number,
  payload: unknown,
  registry: UpcasterRegistry = upcasterRegistry,
): unknown {
  if (schemaVersion >= SCHEMA_VERSION) {
    return payload;
  }
  let current = payload;
  const byVersion = registry.get(type);
  if (!byVersion) {
    return current;
  }
  for (let version = schemaVersion; version < SCHEMA_VERSION; version++) {
    const upcaster = byVersion.get(version);
    if (upcaster) {
      current = upcaster(current);
    }
  }
  return current;
}
