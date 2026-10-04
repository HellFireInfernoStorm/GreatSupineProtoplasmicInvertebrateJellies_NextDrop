---
status: draft
owner: Dinura
sources: guide §8.2
---

# Publish transaction

## 8.2 Publish transaction

1. Begin; take `pg_advisory_xact_lock` on `(depot, ISO week)` of the planning day, so publishes that share a weekly fuel quota are serialised (ADR 0006).
2. Verify draft `revision`, day state, and that orders are closed (demo override allowed).
3. Load reference data, confirmed orders, availability, fuel used this ISO week by every other published day (excluding this day's own published trips).
4. `validatePlan(draft)`. Any HARD violation -> abort with 422 and the violations. Nothing is written.
5. Require a reason for every unassigned confirmed order -> else 422 `MISSING_DEFERRAL_REASON`.
6. Diff against the current published version. Changes touching **locked** stops are rejected with 409 `STOP_LOCKED`. A stop is locked once an applied or accepted-held field fact is in effect (arrived/outcome/POD), its trip is `COMPLETE`, or its `LOADED` order is pinned without a pending reversal. Locked stops retain vehicle, trip and sequence. On a `DEPARTED` trip, an unreported later stop may be removed/deferred or resequenced after every locked stop, but cannot move to another vehicle/trip; new cargo cannot be added (ADR 0053). A `LOADED` order is pinned: removing or moving it is the hard error `ORDER_ALREADY_LOADED` unless a `LOAD_REVERSAL_REQUESTED` exists for it (ADR 0004).
7. Write `PlanVersion` n+1 (immutable snapshot), `PlanVersionChange` rows, upsert `Trip`/`TripStop`, `Deferral` rows, `OrderEvent`s (`ORDER_PLANNED`, `PLAN_CHANGED`, `ORDER_DEFERRED`), store ETAs, `Notification`s.
8. Last step: allocate feed sequence numbers and insert `ChangeFeed` rows (section 9.4). Commit.
9. After commit, broadcast the new feed head over SSE.

Publishing is idempotent per `(planningDayId, draftRevision)`.

Details (ADR 0037):
- `OTHER` and repeat deferrals need a note.
- A moved order gets `ORDER_PLANNED` plus `PLAN_CHANGED`; a LOADED order only `PLAN_CHANGED`.
- Trips are upserted by vehicle and trip number, keeping their display ID; new trips take the next global `Tnnn`.
- Stops are rewritten in place with a 1-based `seq`.
- Notifications: depot loaders and affected drivers get `plan_changed`; each changed order's store gets `eta_updated` or `deferral_notice`.
- `OutletServiceState.deferredLastRun` follows the published deferrals.

Same-trip in-flight re-sequences keep OUT_FOR_DELIVERY and update assignment. Deferring an unreported in-flight stop clears assignment and moves it to DEFERRED; finished orders never regress. Planning inputs retain progressed orders already on published trips without making them generally allocatable.

