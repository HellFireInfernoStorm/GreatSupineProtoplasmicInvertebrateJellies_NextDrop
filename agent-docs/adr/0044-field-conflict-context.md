# ADR 0044: Historical context for field conflicts

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #117
- Designathon departure: no

## Context

Driver R3 needs the original delivery and outlet beside the dispatch change even after its run snapshot is replaced. ADR 0043 recovers outcomes but not the evidence for an open clash. Current assignments and feed hints cannot establish historical reasons.

## Decision

Extend `POST /api/sync/conflicts` with optional `includeContext: true`. Only opted-in requests receive item `context` and response `resetEpoch`; older strict clients retain their existing response shape. Ownership remains the original held fact's session user, including another device for that user. Removal or reassignment never revokes access to that user's original fact.

Context contains the original event envelope (capture/receipt times, clock offset, based plan version and evidence references), and the original published stop/outlet from that planning day's immutable snapshot. It exposes only that order's stop, never the full plan or other users' facts. Missing original history is `null`.

The ordered changes are persisted REMOVED, DEFERRED, MOVED_VEHICLE or MOVED_TRIP records for that order after the based version, published no later than conflict opening. Each carries adjacent before/after version numbers, publication time, minimal trip/vehicle assignments, and available deferral reason/note. Missing snapshots or unrecorded reasons are `null`. A deferred stop is labelled DEFERRED, not presented as a Store cancellation. No dispatcher change is inferred from a Store event or a snapshot diff. Later replans and resolution-time edits do not rewrite this history.

Read conflicts, plan history, outcomes, feed head and reset epoch in a repeatable-read transaction. The head covers every returned resolution. Clients compare reset epochs before using context and fetch a covering snapshot before pruning accepted facts, as in ADR 0043.

Lookup is independent of feed cursor and current assignment. Ask for each locally held fact on every pull, including cold resume. Context, immutable plans and held facts are retained until demo reset; reset discards them and advances the epoch. Unknown, foreign and non-held IDs remain omitted. No new service, migration or event payload is required.

## Consequences

The Driver can persist a truthful side-by-side clash through its Dexie repository. Where history is unavailable it must show that absence instead of inventing a cancellation or reason. Existing outcome recovery and authorization remain in one endpoint. Contract changes merge before #53 consumes this opt-in DTO.
