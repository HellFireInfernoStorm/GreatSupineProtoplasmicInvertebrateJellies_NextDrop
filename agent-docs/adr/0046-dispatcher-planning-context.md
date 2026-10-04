# ADR 0046: Dispatcher planning validation context

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #46
- Designathon departure: no

## Context

The dispatcher must run the shared validator on every manual plan edit. The planning day response previously omitted other-days weekly fuel use, outlet service history and loaded-order pins, although server validation uses them. An empty context can make a local fuel or loaded-order check appear to pass until the server refuses the save.

## Decision

Return required `planningContext` in the scoped planning day response. Serialize the existing authoritative day inputs with UUID identities and integer millilitres: each depot vehicle's other-days weekly fuel (including zero), queued outlets' service age and previous-run deferral flag, and queued loaded orders' vehicle/trip-number pins and reversal-request state. Keep Prisma rows private and business constraints in `packages/rules`.

The browser converts wire identities through its reference map and supplies this context to both local validators. It displays real weekly fuel totals and service ages. Server validation remains mandatory before saving, and optimistic revisions continue to protect the draft. Context is a fetch-time snapshot, not a guarantee that field events have stopped.

The browser bundles the approved `data/reference/district_travel.csv` and `service_allowance.csv` with Vite's `?raw` imports because these tables have no reference API route. The server reads the database tables seeded from those same CSVs; local checks depend on keeping these copies aligned. A future reference endpoint could supply them dynamically instead. Time and fuel meters use the shared `packages/rules` run-usage helper also used by the validator, including its handling of incomplete references and configured budgets.

## Alternatives considered

- Empty local context plus server-only rejection: safe at save time, but fails the live-check requirement and hides useful capacity information.
- Rebuild context from version history: immutable version snapshots do not necessarily reflect cancelled trips or current outlet service state.
- New endpoint or client-supplied trusted state: unnecessary when the day input loader already supplies the authoritative data.

## Consequences

This is an API DTO change requiring the contract maintainer's review and `contract-change` labels. No stored event payload changes, schemaVersion bump, migration or new service is needed. The API contract and dependent dispatcher UI are bundled in one PR. The affected spec files are `spec/platform/api-dtos.md` and `spec/planning/flow.md`.
