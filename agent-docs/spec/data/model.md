---
status: draft
owner: Dinura
sources: guide §6, §6.1
---

# Data model

Schema lives in `apps/api/prisma/schema.prisma`. Prisma models stay inside `apps/api`; `contracts` DTOs cross the boundary. Display IDs are unique string columns beside UUID primary keys.

## 6.1 Models

| Group | Model | Purpose and key fields |
| --- | --- | --- |
| Reference (seeded from CSV, read-only at runtime) | `Outlet` | outlet_id (`OUT001..120`), brand, district, depot, dockType, parkingConstraint, mallWindow, windowOpen, windowClose |
| | `Vehicle` | vehicle_id (`VEH001..060`), type, temp, weightCapKg, volumeCapM3, fuelType, kmPerL, weeklyFuelQuotaL, depot |
| | `District` | name, depot, roadClass, freeFlowKmh, depotToDistrictKm, depotToDistrictFreeflowMin, interStopKm, interStopFreeflowMin |
| | `ServiceAllowance` | (brand, dockType) -> minutes |
| | `CalendarDay` | date, dow, isoYear, isoWeek, isPayday, festival, festivalRamp, isHoliday, monsoon, isOperating |
| | `TrafficSpeed`, `RoadCondition` | districtId + hour + monsoon -> speedIndex; districtId + date -> disruptionIndex; used only for displayed ETAs/risk |
| | `Product` | synthetic catalogue: sku, name, brand, tempRequirement, unitLabel, unitWeightKg, unitVolumeM3 |
| | `Driver` | name, vehicleId, phone (every vehicle has a driver; only some have logins) |
| Identity | `User` | loginId (unique), role, displayName, passwordHash, locale, depot?, outletId?, vehicleId? |
| | `Session` | userId, deviceId, kind (WEB/FIELD), expiresAt (sliding) |
| | `Device` | id (client UUID), userId, kind, appVersion, lastSeenAt, lastSyncAt, pendingCount, lastKnownStop |
| Orders | `Order` | displayId, outletId, brand, tempRequirement, requestedDate, currentDate, status, weightG, volumeL, placedAt, confirmedAt, deferredCount, replacesOrderId?, idempotencyKey |
| | `OrderLine` | orderId, productId, qtyOrdered, qtyLoaded, qtyDelivered, qtyReceived, unit weight/volume snapshot |
| | `OrderEvent` | append-only log (section 7) |
| | `OutletServiceState` | outletId, lastServedDate, deferredLastRun (drives priority inputs) |
| Planning | `PlanningDay` | depot, date, state, ordersClosedAt, currentVersion |
| | `PlanDraft` | planningDayId, revision (optimistic concurrency), data JSONB (trips/stops/unassigned), baseVersion, updatedBy |
| | `PlanVersion` | planningDayId, version, draftRevision (unique within day for publish idempotency), publishedAt, publishedBy, snapshot JSONB (immutable), summary |
| | `PlanVersionChange` | planVersionId, orderId, tripId, change (ADDED, REMOVED, MOVED_VEHICLE, MOVED_TRIP, RESEQUENCED, ETA_CHANGED, DEFERRED) |
| | `Trip` | displayId (`T001`), planningDayId, vehicleId, tripNo (1/2), brand, district, status (PLANNED, READY, DEPARTED, COMPLETE, CANCELLED), plannedDepart, plannedMinutes, km, litres |
| | `TripStop` | tripId, tripStatus (FK-synchronized from Trip.status), orderId, seq, etaMin, windowOpen/Close snapshot, serviceMin |
| | `Deferral` | orderId, planningDayId, planVersion, reasonCode, causeKind, bindingConstraint, scoreInputs JSON, decidedBy (DISPATCHER/SYSTEM), note, nextServiceableDate, daysUnserved, consecutiveDeferrals |
| | `VehicleAvailability` | vehicleId, date, status (AVAILABLE, IN_WORKSHOP), reason (SERVICE, BREAKDOWN), note, setBy, setAt (ADR 0017) |
| Sync | `Conflict` | kind, state (OPEN/RESOLVED), orderId, tripId, heldEventId, opened/resolved by and at, resolution, note |
| | `Blob` | clientBlobId (unique), ownerEventId?, mime, size, bytes (`bytea`) behind a `BlobStore` interface |
| | `ChangeFeed` | seq (BigInt unique), kind, entityType, entityId, version?, audience columns (depot, vehicleId, outletId, roles[]), createdAt |
| | `FeedCounter` | UUID id, unique checked singleton=true, `head` BigInt; sole row initialized by the migration |
| | `Notification` | recipient (userId or role+scope), kind, titleKey, params, entityRef, createdAt, readAt |
| Support | `WeeklyDemandHistory` | depot, brand, isoYear, isoWeek, totalVolumeM3, chilledVolumeM3 (seeded aggregate for the outlook) |
| | `DemoState` | clockOffsetMs, preset, resetEpoch (int, ADR 0007), lastResetBy, lastResetAt |

## Storage conventions (ADR 0023)

Every model has a UUID primary key. Prisma generates UUID v7 defaults; the client-assigned `Device.id` may be provided explicitly. Outlet, Vehicle, Driver and Order/Trip display IDs are globally unique separate columns; Product.sku and User.loginId are unique natural IDs. SQL tables use snake_case mappings, with Prisma field names retained as column names. Foreign keys restrict deletion so history cannot disappear through cascades.

Reference capacities, Product/OrderLine unit snapshots, and WeeklyDemandHistory volumes use Decimal(10,3). Order.weightG and Order.volumeL are positive integers in grams/litres. Instants use timestamptz(3); delivery dates use date. Window, ETA and departure values are local minutes from midnight; mallWindow retains the reference HH:MM-HH:MM text. Calendar.dow follows the reference 0..6 values. Role enums are STORE, DISPATCHER, LOADER, DRIVER; reference enums preserve the CSV spelling. TrafficSpeed is unique by district/hour/monsoon; RoadCondition by district/date.

PlanningDay is unique by depot/date, PlanDraft and OutletServiceState are one per parent, PlanVersion by day/version and day/draftRevision, VehicleAvailability by vehicle/date, and WeeklyDemandHistory by depot/brand/ISO year/week. TripStop's composite FK to Trip(id,status) cascades status updates; its partial order uniqueness covers all statuses except CANCELLED. An inserting/moving writer supplies the current trip status. Moving a failed order removes/moves its current mutable stop, while prior immutable plan snapshots retain history.

DemoState has a unique checked singleton=true key but is populated by the separate seed task. OrderEvent includes the full event envelope and nullable orderId/tripId/vehicleId subjects. Notification supports a user recipient or role plus depot/vehicle/outlet scope.
