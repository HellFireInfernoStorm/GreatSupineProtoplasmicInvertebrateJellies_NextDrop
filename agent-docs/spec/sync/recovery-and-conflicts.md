---
status: draft
owner: Dinura
sources: guide §9.5; issue 54, 97; ADR 0040, 0043, 0044
---

# Recovery rules and conflict classification

## 9.5 Recovery rules and conflict classification

The three recovery rules (built as-is):

1. **Delivery facts recorded by the driver win and keep the phone's capture time.**
2. **Dispatcher changes win for stops not yet visited**; they reach the driver as soon as sync completes.
3. **A true clash is never auto-resolved**; it goes to the dispatcher's exceptions inbox with the driver's proof-of-delivery photo.

Supporting rules: nothing disappears silently (the pending count drops only when the server confirms each record); text syncs before photos.

**Classification** for a field fact on subject stop S, captured under `basedOnPlanVersion = v`, when the current published version is V:

- If `v == V`, or no `PlanVersionChange` in `(v, V]` touches S -> `APPLIED`.
- If S was **removed/cancelled** or **moved to another vehicle/trip** in `(v, V]` and the event is a delivery fact (`STOP_ARRIVED`, `STOP_OUTCOME`, `POD_CAPTURED`) -> **clash**: store with `disposition = HELD`, open a `Conflict` (`FACT_ON_CANCELLED_STOP` or `FACT_ON_REASSIGNED_STOP`), emit `CONFLICT_OPENED`, notify the dispatcher. The fact and its evidence are preserved and visible; the reducer skips it until resolved.
- Two devices report a delivery fact for the same stop -> `DUPLICATE_DELIVERY_FACT` conflict.
- A `LOAD_CONFIRMED` for an order the current plan version no longer holds (removed, cancelled or moved) -> `HELD`, conflict kind `LOAD_AGAINST_CHANGED_PLAN`. The dispatcher resolves it by keeping the order on the truck (re-adding it to the plan) or by requesting a reversal (`LOAD_REVERSAL_REQUESTED`); the loader then confirms with `LOAD_REVERSED` (ADR 0004).
- An event that is now illegal under the transition table and is not merely a late earlier-stage fact -> `ILLEGAL_TRANSITION` conflict or rejection.
- Non-fact events (e.g. `PLAN_ACKNOWLEDGED`) on changed stops -> `APPLIED`.

`CONFLICT_RESOLVED` with `ACCEPT_FACT` makes the reducer apply the held event (keeping its capture time); `REJECT_FACT` leaves it recorded but inert. Resolution is always by the dispatcher.

Details settled in ADR 0040:

- **Planning day.** `v` refers to the subject trip's planning day, else the order's depot on the Colombo capture date. Without `basedOnPlanVersion` there is no version-based classification.
- **Who may report.** A driver whose vehicle held the order in the snapshot at `v` may still report on it, and gets a clash rather than `NOT_ASSIGNED`.
- **Duplicates.** `DUPLICATE_DELIVERY_FACT` applies to `STOP_OUTCOME` and `POD_CAPTURED` when one from another device is already in effect.
- **Illegal transitions.** An illegal delivery fact or `LOAD_CONFIRMED` is held as `ILLEGAL_TRANSITION`. A `STOP_OUTCOME` contradicting the same device's own outcome, and any other illegal event, is rejected.
- **Conflicts and retries.** Each held event opens its own conflict. A retried held event answers `HELD_CONFLICT` again.
- **Accepted facts.** An accepted fact keeps `disposition = HELD`; projections treat it as in effect.

The reporting device learns the decision from `POST /sync/conflicts` (ADR 0043):

- **Request and scope.** The device names its held facts by `clientEventId` and gets only its own user's held events back.
- **Item.** Each item has `conflictId`, `clientEventId`, `kind`, and `OPEN` or `RESOLVED` with the decision, the note and `resolvedAt`.
- **Boundary.** The response's `feedHead` is the confirmation boundary for snapshot reconciliation.
- **Recovery.** Conflicts are kept until a demo reset. The device asks on every pull, so missed hints and cold resumes recover.

### Historical field conflict context (ADR 0044)

`POST /api/sync/conflicts` accepts optional `includeContext: true`. This returns each owned held fact's original envelope and published stop/outlet, plus recorded order-specific removal, deferral or reassignment changes through conflict opening. Changes include before/after versions, publication time, minimal assignments and available deferral reason/note. Missing historical values are explicitly `null`; later replans do not rewrite the clash. Full plans and other users' facts are excluded. Legacy requests retain their existing response shape. Opted-in responses also carry `resetEpoch`, read coherently with history, outcomes and `feedHead`.

Ownership follows the original fact, even after removal/reassignment and on another device for the same user. Lookup ignores feed cursor, so cold resume and missed hints recover context. History survives until demo reset; discard cached context when the epoch changes. Accepted outcomes still require a covering snapshot before pruning. See [ADR 0044](../../adr/0044-field-conflict-context.md).
