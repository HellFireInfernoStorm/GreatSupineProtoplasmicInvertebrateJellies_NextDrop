# ADR 0041: Run monitor states, the exceptions inbox and dispute resolution

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #59
- Designathon departure: no

## Context

[Notifications and monitoring](../spec/platform/notifications-and-monitoring.md) names the D4 run states and their thresholds (`NO_SIGNAL_AFTER_MIN` 10, `BEHIND_GRACE_MIN` 15 in [assumptions](../spec/assumptions.md)) but not the exact rules. The [catalogue](../spec/events/catalogue.md) says `ISSUE_RESOLVED` (CREDIT, ADD_TO_RUN, REJECT) moves a dispute to RECEIVED and that ADD_TO_RUN creates a follow-up order. The `ISSUE_RESOLVED` payload names no issue.

Issue #59 asks for exceptions "with evidence references (store photo, driver POD)", but the exception DTO had no field for them. The runs and exceptions routes take only `?depot=`.

## Decision

1. **The day.** Runs and dock flags belong to today: the Colombo date on the server clock, so the demo clock moves them.
2. **Run states.** A run is one vehicle's trips for the day.
   - **Stops:** a stop is done once its order has an outcome (DELIVERED, RECEIVED, DISPUTED or FAILED). The next open stop is the first stop not done, in planned departure and sequence order.
   - **`lateRisk`:** now is past that stop's planned ETA (`etaMin`).
   - **`BEHIND`:** now is past that ETA by more than `BEHIND_GRACE_MIN`.
   - **`NO_SIGNAL`:** a trip is DEPARTED and the vehicle's drivers have not been heard for more than `NO_SIGNAL_AFTER_MIN`. A run that has not left is never "no signal".
   - **`ESCALATED`** is both NO_SIGNAL and BEHIND.
   - **`DONE`:** every stop has an outcome or every trip is COMPLETE.
   - Otherwise the run is `ON_TRACK`.
3. **Signal fields.** `lastHeardAt` is the latest `Device.lastSeenAt` of the vehicle's drivers; heartbeats and accepted pushes both move it. `lastSyncAt` is the latest across those devices. `pendingCount` comes from the most recently seen device.
4. **`run_updated` hints.**
   - Order facts on a trip emit one, because the counts change.
   - A driver's heartbeat emits one for the vehicle's trips today only when the monitor would change: the run is heard again after a silence, or the pending count or last sync moved. A steady heartbeat writes no feed rows.
   - States that change only with time (NO_SIGNAL, BEHIND) are computed on read; D4 refreshes on a timer.
5. **The inbox lists:**
   - open sync clashes and open disputes (any day);
   - FAILED orders;
   - today's unresolved or held shortfall lines and damaged lines;
   - today's problems and plan acknowledgements.
6. **Evidence** (contract change). CONFLICT, ISSUE, DAMAGED and PROBLEM rows carry `evidence: string[]`, the blob IDs readable through `GET /api/blobs/:id` (ADR 0035):
   - a clash: the held fact's own blobs plus the order's proof-of-delivery photos and signatures;
   - a dispute: the store's photo plus the driver's proof of delivery;
   - a damage line: the loader's photos;
   - a problem: its photo.
7. **Disputes.**
   - **Open until resolved.** An issue (its `ISSUE_REPORTED` event) stays open until an `ISSUE_RESOLVED` follows it on the order. One decision closes every open issue on that order.
   - **Retries.** Repeating the decision returns 200 and writes nothing. A different decision returns 409 `ILLEGAL_TRANSITION`.
   - **ADD_TO_RUN** places one follow-up order with `replacesOrderId` on the first operating day after today. Its idempotency key is `add-to-run:<issueId>`; the store cutoff does not apply because the server places it. Quantities are the issue's line quantities (a line without one sends its ordered quantity). An issue without lines sends whatever the store did not receive.
   - **Notice.** The store is notified with `dispute_updated`.

## Alternatives considered

- **GPS or an ETA model for lateness:** the spec says the monitor is built on delivery events, not GPS.
- **An issue ID in the `ISSUE_RESOLVED` payload:** this is an event schema change with an upcaster, for orders that rarely carry two open disputes.
- **Fetching evidence through the order timeline:** the timeline is store-only, and the dispatcher needs the photos beside the inbox row.

## Consequences

- The web D4 screen (#61) reads `evidence` and refreshes runs periodically.
- Spec edits in this PR: `platform/notifications-and-monitoring.md` and `platform/api-dtos.md`.
