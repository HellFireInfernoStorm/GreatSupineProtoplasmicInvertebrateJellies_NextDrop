---
status: draft
owner: Dinura
sources: guide §6.2
---

# Hand-written SQL constraints

## 6.2 Constraints added via hand-written SQL migrations (Prisma cannot express these)

- Triggers making `order_events`, `plan_versions`, `plan_version_changes` **immutable** (reject UPDATE and DELETE).
- CHECK constraints: quantities >= 0, `tripNo IN (1,2)`, positive weights/volumes.
- Unique `(planningDayId, vehicleId, tripNo)` on `Trip`; partial unique index so an order is on at most one non-cancelled trip.
- Unique `OrderEvent.clientEventId` and `(deviceId, deviceSeq)`.
- Indexes: `OrderEvent(orderId, receivedAt)`, `ChangeFeed(seq)`, `Order(currentDate, status)`, `Trip(planningDayId)`, `PlanVersionChange(planVersionId, orderId)`.

## Initial migration implementation (ADR 0023)

`PlanningDayState` is extended by a separate additive migration for issue #79 to store `OPEN`, `CLOSED`, `PLANNING`, `PUBLISHED`, `IN_PROGRESS` and `COMPLETE`, matching the [calendar lifecycle](../domain/cutoff-and-calendar.md). The initial migration is unchanged; existing rows and the `OPEN` default are preserved. This migration adds enum values only, without changing transitions, CHECK constraints, triggers or indexes.

The Prisma schema expresses supported unique/index/FK constraints; the same initial migration contains the generated definitions plus hand-written CHECK constraints and append-only triggers. ChangeFeed(seq)'s unique index serves the listed sequence lookup (no duplicate non-unique index).

`TripStop(tripId,tripStatus)` references `Trip(id,status)` with ON UPDATE CASCADE. Its partial unique index `trip_stops_active_order_key` covers orderId where tripStatus <> CANCELLED. Status mismatches fail the FK; cancellation updates the index membership; reactivation fails if it would create a duplicate assignment. Prisma 7.10.0 represents this predicate using its partialIndexes preview feature.

Quantities are nonnegative; order totals/capacities/unit sizes are positive; tripNo is 1 or 2. Additional checks enforce nonnegative counters, bounded calendar/time fields, blob size matching bytes, and well-formed field-event idempotency keys (both deviceId/deviceSeq, nonnegative sequence, and clientEventId for FIELD). Weekly demand volumes may be zero and chilled volume cannot exceed total volume.

FeedCounter has a unique boolean key constrained to true, nonnegative head, a migration-inserted row, and a trigger rejecting DELETE. DemoState has a unique boolean key constrained to true and a nonnegative resetEpoch; the seed task owns its initial row. Immutability triggers reject UPDATE/DELETE on order_events, plan_versions and plan_version_changes with SQLSTATE 23514; inserts remain permitted. A deliberate whole-demo reset may use its dedicated reset transaction; it must not use ordinary row deletion on immutable tables.

Product/OrderLine unit snapshots have six decimal places; the positive-size CHECKs operate on the saved Decimal(13,6) values. The same slot uniqueness includes CANCELLED trips; replacement means reactivation of the existing row (ADR 0023).
