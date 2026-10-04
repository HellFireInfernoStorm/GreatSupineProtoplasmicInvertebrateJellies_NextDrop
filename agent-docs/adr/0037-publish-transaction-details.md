# ADR 0037: Publish transaction details

- Status: accepted
- Date: 2026-10-04
- Issue / PR: #48
- Designathon departure: no

## Context

[publish-transaction.md](../spec/planning/publish-transaction.md) lists the steps and writes. Building them in #48 settled details the spec leaves open:

- trip display IDs;
- which events a moved order gets;
- how stops are numbered and rewritten;
- who is notified;
- how outlet service state follows a publish.

## Decision

- **Lock and idempotency.** One interactive transaction takes `pg_advisory_xact_lock(hashtext('publish:<depot>:<isoYear>-<isoWeek>'))`. Under the lock it returns the existing `PlanVersion` for `(planningDayId, draftRevision)` if there is one, so a retry writes nothing.
- **Deferral reasons.** Every confirmed order not on a trip needs a reason code. `OTHER` needs a note, and so does an order the validator flags `REPEAT_DEFERRAL`. Otherwise publish returns 422 `MISSING_DEFERRAL_REASON`, with the validation result and `params.orders`.
- **Locked stops (amended by ADR 0053 and #159).** A stop is locked when an applied or accepted-held `STOP_ARRIVED`, `STOP_OUTCOME` or `POD_CAPTURED` is in effect, its trip is COMPLETE, or its LOADED order is pinned without a pending reversal. Locked stops keep their vehicle and trip number, and keep relative order among locked stops on that trip; removing earlier unlocked stops may compact numeric sequence. Unreported departed stops may be removed/deferred or resequenced after locked stops, but cannot change vehicle/trip; departed trips cannot receive new cargo. COMPLETE trips cannot change. Illegal edits return 409 `STOP_LOCKED` with the order ID. LOADED-order validation remains authoritative (`ORDER_ALREADY_LOADED`, ADR 0004).
- **Trips.**
  - Trips are upserted by `(planningDay, vehicle, tripNo)`. An existing row keeps its display ID; a cancelled one is reactivated.
  - A new trip takes the next free global `Tnnn`. If two depots race for the same number, the unique index refuses one and that publish retries once.
  - Trips no longer in the plan become CANCELLED.
  - Times, km and litres come from `computeRunSchedule`, `computeTripTime` and `computeFuel` (display departure and ETAs).
- **Stops.** Stops are rewritten in place. Leaving stops are deleted first, which frees the one-active-stop-per-order index. Kept stops are re-sequenced in two passes, and new stops are created. `seq` is stored 1-based (the rules core counts from 0).
- **Events.**
  - An order newly on a trip, or moved, gets `ORDER_PLANNED`, so the reducer's assignment follows the plan. A moved order also gets `PLAN_CHANGED { from, to }` for its timeline and notice.
  - A LOADED order only ever gets `PLAN_CHANGED`: `ORDER_PLANNED` would move it out of LOADED (ADR 0004).
  - A deferred order gets `ORDER_DEFERRED`, a `Deferral` row whose consequence fields come from `explainDeferral` (with the dispatcher's reason and note), and the next-day rollover: `currentDate` set to the next serviceable date and `deferredCount + 1`.
- **Change rows.** Changes are classified per order in this order: ADDED, MOVED_VEHICLE, MOVED_TRIP, RESEQUENCED, ETA_CHANGED, DEFERRED. An unchanged order gets no row.
- **Snapshot.** `PlanVersion.snapshot` holds the published trips as `TripDto`s and the deferral DTOs. `GET .../versions` returns it as written.
- **Notifications.**
  - The depot's loaders and the drivers of every affected vehicle get `plan_changed`.
  - Each changed order's store gets `eta_updated`, or `deferral_notice` when deferred.
  - Feed rows are `order_changed` per changed order, plus `plan_published` for dispatchers and loaders of the depot and one per affected vehicle for drivers (ADR 0029). They are appended last.
- **Service state.** Publishing sets `OutletServiceState.deferredLastRun` for every outlet in the day's queue: true when one of its orders was deferred, false otherwise.

## Alternatives considered

- Delete and recreate every stop: stop IDs would change under offline driver devices.
- `PLAN_CHANGED` alone for moves: the reducer ignores it (informational), so the order's assignment would go stale.
- A Postgres sequence for trip numbers: a schema change for a rare cross-depot race.

## Consequences

A republish keeps stop IDs stable for unchanged stops. Already-deferred orders leave the day's queue at publish, so re-adding one means planning the next day. Spec edited: `planning/publish-transaction.md`.
