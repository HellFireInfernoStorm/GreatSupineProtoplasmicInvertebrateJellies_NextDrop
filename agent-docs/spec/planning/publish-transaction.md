---
status: draft
owner: Dinura
sources: guide §8.2
---

# Publish transaction

## 8.2 Publish transaction

1. Begin; take `pg_advisory_xact_lock` for the planning day.
2. Verify draft `revision`, day state, and that orders are closed (demo override allowed).
3. Load reference data, confirmed orders, availability, fuel used this ISO week (excluding this day's own published trips).
4. `validatePlan(draft)`. Any HARD violation -> abort with 422 and the violations. Nothing is written.
5. Require a reason for every unassigned confirmed order -> else 422 `MISSING_DEFERRAL_REASON`.
6. Diff against the current published version. Changes touching **locked** stops are rejected with 409 `STOP_LOCKED`. A stop is locked once the server holds a field fact for it (arrived/outcome/POD) or its trip is `DEPARTED`.
7. Write `PlanVersion` n+1 (immutable snapshot), `PlanVersionChange` rows, upsert `Trip`/`TripStop`, `Deferral` rows, `OrderEvent`s (`ORDER_PLANNED`, `PLAN_CHANGED`, `ORDER_DEFERRED`), store ETAs, `Notification`s.
8. Last step: allocate feed sequence numbers and insert `ChangeFeed` rows (section 9.4). Commit.
9. After commit, broadcast the new feed head over SSE.

Publishing is idempotent per `(planningDayId, draftRevision)`.
