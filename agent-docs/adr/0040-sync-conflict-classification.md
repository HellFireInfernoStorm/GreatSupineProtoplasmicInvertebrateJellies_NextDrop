# ADR 0040: Sync conflict classification and resolution details

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #54
- Designathon departure: no

## Context

[Recovery and conflicts](../spec/sync/recovery-and-conflicts.md) classifies a field fact captured under `basedOnPlanVersion = v` against the `PlanVersionChange` rows in `(v, V]`. It names the conflict kinds and says the dispatcher accepts or rejects each clash. Building it in #54 settled what the spec leaves open:

- which planning day `v` refers to
- how a driver is allowed to report on a stop that is no longer theirs
- what counts as a duplicate report
- when an illegal transition is a conflict rather than a rejection
- how retries and accepted facts behave, given that `disposition` is immutable ([envelope](../spec/events/envelope.md))

[ADR 0034](0034-field-ingest-and-snapshot.md) rejected every illegal transition until classification landed.

## Decision

1. **Planning day.** A fact's `v` refers to the planning day of its subject trip. Without a trip it refers to the order's depot on the fact's Colombo capture date. If the event has no `basedOnPlanVersion`, or `v` is the day's current version, there is no version-based classification.
2. **The plan the device saw.** `PlanVersion.snapshot` for version `v` gives the order's trip and vehicle at `v`.
   - A driver whose vehicle held the order at `v` may report on it even after a newer plan moved or removed it; that is the clash the spec describes. Any other driver still gets `NOT_ASSIGNED`.
   - A loader in the order's depot may report a load for an order the plan at `v` held.
3. **Clashes.** The trigger is a change in `(v, V]` that moved or removed the stop: `DEFERRED`, `REMOVED`, `MOVED_VEHICLE` or `MOVED_TRIP`.
   - **Delivery facts** (`STOP_ARRIVED`, `STOP_OUTCOME`, `POD_CAPTURED`):
     - with no current stop → `FACT_ON_CANCELLED_STOP`
     - on another trip → `FACT_ON_REASSIGNED_STOP`
     - an order moved away and back onto the same trip is applied
   - **`LOAD_CONFIRMED`** in the same case → `LOAD_AGAINST_CHANGED_PLAN`. Keep-on-truck and reversal outcomes stay out of scope (ADR 0004); here the dispatcher accepts or rejects.
4. **Duplicates.** A `STOP_OUTCOME` or `POD_CAPTURED` is held as `DUPLICATE_DELIVERY_FACT` when one of the same type from another device is already in effect for the order. A second `STOP_ARRIVED` is harmless and applies.
5. **Illegal transitions.** An illegal field fact (a delivery fact or `LOAD_CONFIRMED`) is held as `ILLEGAL_TRANSITION`, because it happened in the world and must not be lost. Two cases are still rejected with `ILLEGAL_TRANSITION`:
   - a `STOP_OUTCOME` that contradicts the same device's own applied outcome, which the device corrects itself;
   - any other illegal event, such as `TRIP_READY` or `LOAD_SHORT`.

   A late earlier-stage fact is still recorded without moving status. Non-fact events on changed stops apply.
6. **Holding.** One short transaction does all of the following, with the feed rows last:
   - stores the fact with `disposition = HELD` and links its blobs;
   - opens one `Conflict` per held event, recording the device's trip;
   - emits `CONFLICT_OPENED`;
   - notifies the depot's dispatchers with `conflict_opened`;
   - appends `conflict_opened` (dispatchers and the reporting device's scope) and `order_changed` feed rows.

   The result is `HELD_CONFLICT` with the conflict ID. A retried held event answers `HELD_CONFLICT` with the same conflict again, not `DUPLICATE`, so a device that lost the response still learns about it.
7. **Resolution.** `POST /api/dispatch/conflicts/:id/resolve` is for dispatchers of the conflict's depot. It closes the conflict by compare-and-set and emits `CONFLICT_RESOLVED` with `heldEventId`.
   - **On `ACCEPT_FACT`**, the reducer applies the held event, forced, with its capture time. The order's status and line quantities are projected. A delivery sets `confirmedAt` to the fact's receipt time and notifies the store.
   - **`REJECT_FACT`** leaves the fact recorded but inert.
   - **Retries.** Repeating the decision returns 200 and writes nothing; a different decision returns 409 `ILLEGAL_TRANSITION`.
   - **Feed.** It appends `conflict_resolved` and `order_changed`.
8. **Accepted facts in projections.** `disposition` stays `HELD`, because it is immutable. Projections and duplicate detection treat an event as in effect when it was applied at insert or a `CONFLICT_RESOLVED` accepted it.

## Alternatives considered

- **Rejecting a driver whose stop moved, as before:** the delivery would surface only as a failed event on the phone. The spec requires it in the dispatcher's inbox with its proof.
- **One conflict per stop visit instead of per held event:** `Conflict.heldEventId` is unique. Grouping arrival, outcome and proof is left to the inbox UI.
- **Flipping `disposition` to APPLIED on accept:** this breaks the immutable envelope, and replaying the log would apply the fact twice.
- **Rejecting every illegal transition:** this loses facts that happened in the world, such as a delivery whose departure never reached the server.

## Consequences

- Field clients must send `basedOnPlanVersion` for clash detection; without it a fact on a moved stop is refused `NOT_ASSIGNED`.
- Delivering resolutions to the field device is #97.
- Spec edits in this PR: `sync/recovery-and-conflicts.md` and `sync/push-protocol.md`.
