import type { EventType } from "./event-types";
import { SCHEMA_VERSION } from "./schema-version";

export type PayloadUpcaster = (payload: unknown) => unknown;

/** Maps event type -> fromVersion -> upcaster to the next version. */
export type UpcasterRegistry = Map<EventType, Map<number, PayloadUpcaster>>;

/**
 * Shared registry. `LOAD_DAMAGED` v1→v2 fills a missing `reasonCode` with `OTHER` (ADR 0041).
 * Other types have no payload change at v2; missing entries are no-ops.
 */
export const upcasterRegistry: UpcasterRegistry = new Map([
  [
    "LOAD_DAMAGED",
    new Map([
      [
        1,
        (payload: unknown) => {
          const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
          return body.reasonCode === undefined ? { ...body, reasonCode: "OTHER" } : payload;
        },
      ],
    ]),
  ],
]);

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
