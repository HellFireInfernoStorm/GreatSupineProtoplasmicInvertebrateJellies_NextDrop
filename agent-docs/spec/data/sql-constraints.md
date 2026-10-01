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
