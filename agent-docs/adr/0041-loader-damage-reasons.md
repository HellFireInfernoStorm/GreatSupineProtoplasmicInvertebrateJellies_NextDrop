# ADR 0041: Loader damage reason codes on LOAD_DAMAGED

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #114
- Designathon departure: no

## Context

The L2 damaged sheet (Figma `359:3405`, damage in progress `159:1381`) and Loader issue #52 need quantity, reason chips and optional photo evidence. `LOAD_DAMAGED` only carried `lines` and optional `photoRef`. `/ref/reasons` and the field snapshot exposed `loadShort` but no damage list, so a Loader UI could not send or recover a chosen reason through the supported contract. Shortfall codes must not be reused for damage.

## Decision

1. **Catalogue.** Contracts owns `LOAD_DAMAGED_REASON_CODES`: `CRUSHED`, `LEAKING`, `TORN_PACKAGING`, `CONTAMINATED`, `OTHER`. Message keys are `loadDamaged.<code>`. The design draws chips without naming them; these are the build's provisional codes (same approach as ADR 0034 for load-short).
2. **Payload.** Current `LOAD_DAMAGED` requires `reasonCode` from that catalogue, plus `lines` and optional `photoRef`.
3. **Reference and snapshot.** `reasonsResponse` and `reasonLists()` include `loadDamaged`. Field snapshot `config.reasons` and `GET /ref/reasons` share the same lists.
4. **Versioning.** `SCHEMA_VERSION` is 2. A `LOAD_DAMAGED` v1→v2 upcaster adds `reasonCode: "OTHER"` when the field is missing so stored and offline v1 events remain readable. Other event types are unchanged at v2 (no-op upcast). Accepted field events persist at the current schema version after upcast.
5. **Projection.** Order `flags.damaged` stays `{ lineId, qty }` (reason is per event, like shortfall reason on the timeline). Timeline and stored payloads carry the reason.
6. **Export for #52.** Web imports `LOAD_DAMAGED_REASON_CODES` / `loadDamagedReasonCodeSchema` from `@nextdrop/contracts` and renders chips from `config.reasons.loadDamaged` (or `/ref/reasons`).

## Alternatives considered

- **Reuse `loadShort` codes (including `DAMAGED_AT_DOCK`)**: conflates stock shortfall with damage reporting; rejected by the issue.
- **Optional `reasonCode` without a version bump**: contracts policy requires a bump and upcaster when a payload changes.
- **Put reason on order flags**: shortfall reason is already event-scoped; keep the same pattern.

## Consequences

- Spec edits in this PR: `events/catalogue.md`, `sync/versioning-and-clocks.md`, `platform/api-dtos.md`; ADR 0034 reason-list note updated.
- #52 can implement the damaged sheet against the contracts export and snapshot list without inventing payload fields.
