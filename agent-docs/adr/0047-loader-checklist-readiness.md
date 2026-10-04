# ADR 0047: Shared Loader checklist readiness for TRIP_READY

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #115 / #124
- Designathon departure: no

## Context

Issue #52 requires Loader hand-over to stay blocked until every checklist row is checked and every short line permits departure. Shared rules already expose `shortLinesBlockingReady` (unresolved and `HOLD_TRIP`), and `TRIP_READY` ingest only consulted that. An unchecked PLANNED trip with no shorts could become READY. Order status is not a safe completeness proxy: one `LOAD_CONFIRMED` line moves the order to `LOADED` while other lines stay untouched. `OrderState` previously tracked short/damaged flags but not per-line loaded quantities. A web-only gate would re-implement a business constraint outside `packages/rules`.

## Decision

1. **Checked.** For each ordered line, the line is checked when
   `qtyLoaded + ΣqtyShort(line) + ΣqtyDamaged(line) >= qtyOrdered`.
   Zero-loaded fully short or fully damaged lines are checked. Status `LOADED` alone is not. Over-accounting (`>=`) is accepted; under-accounting blocks.

2. **Shared gate.** `packages/rules` exports `tripChecklistReadiness` (and `orderChecklistReadiness`). It reports `incompleteLines` and `blockingShorts` (composed from unchanged `shortLinesBlockingReady`). `SHIP_PARTIAL` / `BACKORDER` do not block when the checklist is otherwise complete; unresolved and `HOLD_TRIP` still do.

3. **Reducer and projection.** `OrderState.loaded` records per-line quantities from `LOAD_CONFIRMED`. On `LOAD_REVERSED`, the reducer clears `loaded`, `short` and `damaged` so the next dock cycle starts unchecked (timeline events remain append-only). The API's `projectFact` also resets every `OrderLine.qtyLoaded` to 0 on `LOAD_REVERSED`, because ingest always passes that column into the gate (never falls back to reducer state when the column is 0). Callers may still pass authoritative `qtyLoaded` overrides; the API always passes OrderLine values.

4. **Enforce.** `TRIP_READY` ingest refuses with `ILLEGAL_TRANSITION` when `tripChecklistReadiness` is not ready, using every stop order's lines and reduced state.

5. **DTO.** No new wire fields. Order `lines` and `flags` already carry the inputs. #52 consumes `tripChecklistReadiness` from `@nextdrop/rules` against Dexie-projected orders; the server re-validates on ingest.

## Alternatives considered

- **Require every order `LOADED`:** fails zero-loaded fully short/damaged stops that never emit `LOAD_CONFIRMED`, and still allows a partial multi-line confirm.
- **Web-only checklist:** violates the rules-core boundary; clients could POST `TRIP_READY` directly.
- **Exact equality instead of `>=`:** rejects harmless over-reports (e.g. damaged after a full confirm) without a product need.

## Consequences

- Spec edits in this PR: `events/catalogue.md`, `sync/push-protocol.md`, `planning/other-behaviours.md`; ADR 0034 trip-fact note updated.
- #52 wires L3 to `tripChecklistReadiness`; no contract-change label.
