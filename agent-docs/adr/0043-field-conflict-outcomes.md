# ADR 0043: Conflict outcomes for field devices

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #97
- Designathon departure: no

## Context

A field fact that clashes with a newer plan is stored `HELD` and answers `HELD_CONFLICT` ([ADR 0040](0040-sync-conflict-classification.md)). The dispatcher then accepts or rejects it. The device had no authorised way to learn that decision:

- The `conflict_resolved` feed row is a hint: `{ seq, kind, entity, version?, at }`, with no decision.
- The field snapshot has no conflicts.
- The conflict DTO is only on dispatcher (`/dispatch/exceptions`) and store (order timeline) endpoints.

So the web offline core (PR #96) had to keep every held fact held, marked `RESOLUTION_DETAILS_UNAVAILABLE`. The driver could not tell an accepted delivery from a rejected one. Hints can also be missed: the device may be offline, or its saved feed cursor may already be past the resolution after a cold resume.

## Decision

1. **Endpoint.** `POST /api/sync/conflicts` (route `fieldConflicts`, Loader and Driver, mutation headers).
   - The body is `{ clientEventIds }`, 1 to 100 IDs: the device's own facts that it still holds.
   - It is a read, but sent as POST so a list of IDs fits the body. Field roles still send nothing to the server outside `/sync/*`.
2. **Scope.** The answer lists only held events whose actor is the session user. IDs that are unknown, belong to another user, or were not held are left out, so the response never reveals whether someone else's event exists. The same user on another device sees the same outcomes. No dispatcher or store endpoint is involved.
3. **Item.** Each item names the `conflictId` and the original `clientEventId`, plus the conflict `kind` and `openedAt`.
   - `state: OPEN` carries no decision.
   - `state: RESOLVED` carries `resolution` (`ACCEPT_FACT` or `REJECT_FACT`), the dispatcher's `note` (nullable) and `resolvedAt`.
4. **Confirmation boundary.** The response carries `feedHead`, read after the conflicts. Every listed decision committed together with its feed rows, so a snapshot whose `feedCursor` is at or past `feedHead` reflects all of them. This is the same rule as the push response's `feedHead`.
5. **Retention and recovery.** Conflicts and held events are never deleted. Only a demo reset discards them, and it changes `resetEpoch`, so the device discards its outbox anyway (ADR 0007). The client asks about every fact it still holds on each pull, whatever its feed cursor, so missed hints and cold resumes recover the same way. A `conflict_resolved` hint only triggers a sync pass.
6. **Client handling** (`apps/web/src/sync`):
   - **Accepted:** the fact becomes `acked` with `confirmationFeedHead = feedHead`. It stays projected until a covering snapshot prunes it. The controller fetches a snapshot after any decision.
   - **Rejected:** the fact becomes `rejected` with `lastError = CONFLICT_REJECTED` and the decision. It is no longer projected, stays in the diagnostics with the dispatcher's note, and is never pruned.
   - **Open, unknown, uncorrelated or unreachable:** the fact stays held. A failed outcome request does not block pushing new work.

## Alternatives considered

- **Outcomes in the field snapshot:** the snapshot is scoped to a date and a vehicle or depot, so a held fact from another day, or on a stop that has moved, would drop out of it. Asking by `clientEventId` is independent of plan scope.
- **Decision in the `conflict_resolved` feed row:** feed rows are hints, and depot-wide audiences would show other users' decisions. A missed hint would still need a recovery path.
- **`GET` with a time window:** this needs a retention rule and returns facts the device no longer holds. Asking by ID needs neither.
- **Lookup by conflict ID:** the device always has the `clientEventId`; the `conflictId` arrives only in a push response that may have been lost.

## Consequences

- An additive contract change: `fieldConflictsRequest`, `fieldConflict` and `fieldConflictsResponse`, and route `fieldConflicts`.
- `RESOLUTION_DETAILS_UNAVAILABLE` is gone from the client.
- Rejected facts show "the dispatcher did not accept…" with the note, through new i18n keys `sync.rejectedAction` and `sync.dispatcherNote`.
- Spec edits in this PR: `sync/recovery-and-conflicts.md`, `sync/push-protocol.md`, `sync/offline-client.md` and `platform/api.md`.
