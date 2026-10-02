-- CreateEnum
CREATE TYPE "Brand" AS ENUM ('Fresh', 'Style', 'Tech');

-- CreateEnum
CREATE TYPE "DockType" AS ENUM ('rear_dock', 'street', 'mall_bay');

-- CreateEnum
CREATE TYPE "ParkingConstraint" AS ENUM ('normal', 'van_only', 'mall_dock');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('truck', 'van');

-- CreateEnum
CREATE TYPE "VehicleTemp" AS ENUM ('reefer', 'ambient');

-- CreateEnum
CREATE TYPE "TempRequirement" AS ENUM ('chilled', 'ambient');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STORE', 'DISPATCHER', 'LOADER', 'DRIVER');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('WEB', 'FIELD');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('ORDERED', 'PLANNED', 'DEFERRED', 'LOADED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RECEIVED', 'FAILED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('SERVER', 'FIELD');

-- CreateEnum
CREATE TYPE "EventDisposition" AS ENUM ('APPLIED', 'HELD');

-- CreateEnum
CREATE TYPE "PlanningDayState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'READY', 'DEPARTED', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanChange" AS ENUM ('ADDED', 'REMOVED', 'MOVED_VEHICLE', 'MOVED_TRIP', 'RESEQUENCED', 'ETA_CHANGED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "DecisionAuthor" AS ENUM ('DISPATCHER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'IN_WORKSHOP');

-- CreateEnum
CREATE TYPE "AvailabilityReason" AS ENUM ('SERVICE', 'BREAKDOWN');

-- CreateEnum
CREATE TYPE "ConflictState" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "outlets" (
    "id" UUID NOT NULL,
    "displayId" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "depot" TEXT NOT NULL,
    "dockType" "DockType" NOT NULL,
    "parkingConstraint" "ParkingConstraint" NOT NULL,
    "mallWindow" TEXT,
    "windowOpen" INTEGER NOT NULL,
    "windowClose" INTEGER NOT NULL,
    "districtId" UUID NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "displayId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "temp" "VehicleTemp" NOT NULL,
    "weightCapKg" DECIMAL(10,3) NOT NULL,
    "volumeCapM3" DECIMAL(10,3) NOT NULL,
    "fuelType" TEXT NOT NULL,
    "kmPerL" DECIMAL(10,3) NOT NULL,
    "weeklyFuelQuotaL" DECIMAL(10,3) NOT NULL,
    "depot" TEXT NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "depot" TEXT NOT NULL,
    "roadClass" TEXT NOT NULL,
    "freeFlowKmh" DECIMAL(10,3) NOT NULL,
    "depotToDistrictKm" DECIMAL(10,3) NOT NULL,
    "depotToDistrictFreeflowMin" INTEGER NOT NULL,
    "interStopKm" DECIMAL(10,3) NOT NULL,
    "interStopFreeflowMin" INTEGER NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_allowances" (
    "id" UUID NOT NULL,
    "brand" "Brand" NOT NULL,
    "dockType" "DockType" NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "service_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_days" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "dow" INTEGER NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "isPayday" BOOLEAN NOT NULL,
    "festival" TEXT,
    "festivalRamp" DECIMAL(10,3) NOT NULL,
    "isHoliday" BOOLEAN NOT NULL,
    "monsoon" BOOLEAN NOT NULL,
    "isOperating" BOOLEAN NOT NULL,

    CONSTRAINT "calendar_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_speeds" (
    "id" UUID NOT NULL,
    "hour" INTEGER NOT NULL,
    "monsoon" BOOLEAN NOT NULL,
    "speedIndex" DECIMAL(10,3) NOT NULL,
    "districtId" UUID NOT NULL,

    CONSTRAINT "traffic_speeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_conditions" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "disruptionIndex" DECIMAL(10,3) NOT NULL,
    "note" TEXT,
    "districtId" UUID NOT NULL,

    CONSTRAINT "road_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "tempRequirement" "TempRequirement" NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitWeightKg" DECIMAL(10,3) NOT NULL,
    "unitVolumeM3" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "displayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicleId" UUID NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "loginId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "depot" TEXT,
    "outletId" UUID,
    "vehicleId" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "appVersion" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSyncAt" TIMESTAMPTZ(3),
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "lastKnownStop" UUID,
    "userId" UUID NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "displayId" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "tempRequirement" "TempRequirement" NOT NULL,
    "requestedDate" DATE NOT NULL,
    "currentDate" DATE NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'ORDERED',
    "weightG" INTEGER NOT NULL,
    "volumeL" INTEGER NOT NULL,
    "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "deferredCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "outletId" UUID NOT NULL,
    "replacesOrderId" UUID,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "qtyLoaded" INTEGER NOT NULL DEFAULT 0,
    "qtyDelivered" INTEGER NOT NULL DEFAULT 0,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "unitWeightKg" DECIMAL(10,3) NOT NULL,
    "unitVolumeM3" DECIMAL(10,3) NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "clientEventId" UUID,
    "deviceSeq" INTEGER,
    "type" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "source" "EventSource" NOT NULL,
    "actorRole" "Role" NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "clockOffsetMs" BIGINT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "basedOnPlanVersion" INTEGER,
    "disposition" "EventDisposition" NOT NULL DEFAULT 'APPLIED',
    "payload" JSONB NOT NULL,
    "orderId" UUID,
    "tripId" UUID,
    "vehicleId" UUID,
    "deviceId" UUID,
    "actorUserId" UUID NOT NULL,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlet_service_states" (
    "id" UUID NOT NULL,
    "lastServedDate" DATE,
    "deferredLastRun" BOOLEAN NOT NULL DEFAULT false,
    "outletId" UUID NOT NULL,

    CONSTRAINT "outlet_service_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_days" (
    "id" UUID NOT NULL,
    "depot" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "state" "PlanningDayState" NOT NULL DEFAULT 'OPEN',
    "ordersClosedAt" TIMESTAMPTZ(3),
    "currentVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "planning_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_drafts" (
    "id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "baseVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "planningDayId" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,

    CONSTRAINT "plan_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "planningDayId" UUID NOT NULL,
    "publishedBy" UUID NOT NULL,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_version_changes" (
    "id" UUID NOT NULL,
    "change" "PlanChange" NOT NULL,
    "planVersionId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tripId" UUID,

    CONSTRAINT "plan_version_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "displayId" TEXT NOT NULL,
    "tripNo" INTEGER NOT NULL,
    "brand" "Brand" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedDepart" INTEGER NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "km" DECIMAL(10,3) NOT NULL,
    "litres" DECIMAL(10,3) NOT NULL,
    "planningDayId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "districtId" UUID NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "tripStatus" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "seq" INTEGER NOT NULL,
    "etaMin" INTEGER NOT NULL,
    "windowOpen" INTEGER NOT NULL,
    "windowClose" INTEGER NOT NULL,
    "serviceMin" INTEGER NOT NULL,
    "orderId" UUID NOT NULL,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferrals" (
    "id" UUID NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "causeKind" TEXT NOT NULL,
    "bindingConstraint" TEXT,
    "scoreInputs" JSONB NOT NULL,
    "decidedBy" "DecisionAuthor" NOT NULL,
    "note" TEXT,
    "nextServiceableDate" DATE NOT NULL,
    "daysUnserved" INTEGER NOT NULL,
    "consecutiveDeferrals" INTEGER NOT NULL,
    "orderId" UUID NOT NULL,
    "planningDayId" UUID NOT NULL,

    CONSTRAINT "deferrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_availability" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "reason" "AvailabilityReason",
    "note" TEXT,
    "setAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleId" UUID NOT NULL,
    "setBy" UUID NOT NULL,

    CONSTRAINT "vehicle_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflicts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" "ConflictState" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "note" TEXT,
    "orderId" UUID,
    "tripId" UUID,
    "heldEventId" UUID NOT NULL,
    "openedBy" UUID NOT NULL,
    "resolvedBy" UUID,

    CONSTRAINT "conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blobs" (
    "id" UUID NOT NULL,
    "clientBlobId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "ownerEventId" UUID,

    CONSTRAINT "blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_feed" (
    "id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER,
    "depot" TEXT,
    "vehicleId" UUID,
    "outletId" UUID,
    "roles" "Role"[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_counter" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "head" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "feed_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "role" "Role",
    "depot" TEXT,
    "vehicleId" UUID,
    "outletId" UUID,
    "kind" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "entityRef" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),
    "userId" UUID,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_demand_history" (
    "id" UUID NOT NULL,
    "depot" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "totalVolumeM3" DECIMAL(10,3) NOT NULL,
    "chilledVolumeM3" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "weekly_demand_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_state" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "clockOffsetMs" BIGINT NOT NULL DEFAULT 0,
    "preset" TEXT NOT NULL,
    "resetEpoch" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMPTZ(3),
    "lastResetBy" UUID,

    CONSTRAINT "demo_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outlets_displayId_key" ON "outlets"("displayId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_displayId_key" ON "vehicles"("displayId");

-- CreateIndex
CREATE UNIQUE INDEX "districts_name_key" ON "districts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "service_allowances_brand_dockType_key" ON "service_allowances"("brand", "dockType");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_days_date_key" ON "calendar_days"("date");

-- CreateIndex
CREATE UNIQUE INDEX "traffic_speeds_districtId_hour_monsoon_key" ON "traffic_speeds"("districtId", "hour", "monsoon");

-- CreateIndex
CREATE UNIQUE INDEX "road_conditions_districtId_date_key" ON "road_conditions"("districtId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_displayId_key" ON "drivers"("displayId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_vehicleId_key" ON "drivers"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_loginId_key" ON "users"("loginId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_displayId_key" ON "orders"("displayId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "orders_currentDate_status_idx" ON "orders"("currentDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_orderId_productId_key" ON "order_lines"("orderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_clientEventId_key" ON "order_events"("clientEventId");

-- CreateIndex
CREATE INDEX "order_events_orderId_receivedAt_idx" ON "order_events"("orderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_deviceId_deviceSeq_key" ON "order_events"("deviceId", "deviceSeq");

-- CreateIndex
CREATE UNIQUE INDEX "outlet_service_states_outletId_key" ON "outlet_service_states"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "planning_days_depot_date_key" ON "planning_days"("depot", "date");

-- CreateIndex
CREATE UNIQUE INDEX "plan_drafts_planningDayId_key" ON "plan_drafts"("planningDayId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_planningDayId_version_key" ON "plan_versions"("planningDayId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_planningDayId_draftRevision_key" ON "plan_versions"("planningDayId", "draftRevision");

-- CreateIndex
CREATE INDEX "plan_version_changes_planVersionId_orderId_idx" ON "plan_version_changes"("planVersionId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "trips_displayId_key" ON "trips"("displayId");

-- CreateIndex
CREATE INDEX "trips_planningDayId_idx" ON "trips"("planningDayId");

-- CreateIndex
CREATE UNIQUE INDEX "trips_planningDayId_vehicleId_tripNo_key" ON "trips"("planningDayId", "vehicleId", "tripNo");

-- CreateIndex
CREATE UNIQUE INDEX "trips_id_status_key" ON "trips"("id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_tripId_seq_key" ON "trip_stops"("tripId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_tripId_orderId_key" ON "trip_stops"("tripId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_active_order_key" ON "trip_stops"("orderId") WHERE ("tripStatus" <> 'CANCELLED'::"TripStatus");

-- CreateIndex
CREATE UNIQUE INDEX "deferrals_orderId_planningDayId_planVersion_key" ON "deferrals"("orderId", "planningDayId", "planVersion");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_availability_vehicleId_date_key" ON "vehicle_availability"("vehicleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "conflicts_heldEventId_key" ON "conflicts"("heldEventId");

-- CreateIndex
CREATE UNIQUE INDEX "blobs_clientBlobId_key" ON "blobs"("clientBlobId");

-- CreateIndex
CREATE UNIQUE INDEX "change_feed_seq_key" ON "change_feed"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "feed_counter_singleton_key" ON "feed_counter"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_demand_history_depot_brand_isoYear_isoWeek_key" ON "weekly_demand_history"("depot", "brand", "isoYear", "isoWeek");

-- CreateIndex
CREATE UNIQUE INDEX "demo_state_singleton_key" ON "demo_state"("singleton");

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_speeds" ADD CONSTRAINT "traffic_speeds_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_conditions" ADD CONSTRAINT "road_conditions_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_replacesOrderId_fkey" FOREIGN KEY ("replacesOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet_service_states" ADD CONSTRAINT "outlet_service_states_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_drafts" ADD CONSTRAINT "plan_drafts_planningDayId_fkey" FOREIGN KEY ("planningDayId") REFERENCES "planning_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_drafts" ADD CONSTRAINT "plan_drafts_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_planningDayId_fkey" FOREIGN KEY ("planningDayId") REFERENCES "planning_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_version_changes" ADD CONSTRAINT "plan_version_changes_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_version_changes" ADD CONSTRAINT "plan_version_changes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_version_changes" ADD CONSTRAINT "plan_version_changes_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_planningDayId_fkey" FOREIGN KEY ("planningDayId") REFERENCES "planning_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tripId_tripStatus_fkey" FOREIGN KEY ("tripId", "tripStatus") REFERENCES "trips"("id", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_planningDayId_fkey" FOREIGN KEY ("planningDayId") REFERENCES "planning_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_availability" ADD CONSTRAINT "vehicle_availability_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_availability" ADD CONSTRAINT "vehicle_availability_setBy_fkey" FOREIGN KEY ("setBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_heldEventId_fkey" FOREIGN KEY ("heldEventId") REFERENCES "order_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_openedBy_fkey" FOREIGN KEY ("openedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_ownerEventId_fkey" FOREIGN KEY ("ownerEventId") REFERENCES "order_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_state" ADD CONSTRAINT "demo_state_lastResetBy_fkey" FOREIGN KEY ("lastResetBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written safeguards. Prisma replays this SQL in its shadow database.
CREATE FUNCTION reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER order_events_immutable BEFORE UPDATE OR DELETE ON "order_events" FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER plan_versions_immutable BEFORE UPDATE OR DELETE ON "plan_versions" FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER plan_version_changes_immutable BEFORE UPDATE OR DELETE ON "plan_version_changes" FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_check_1" CHECK ("weightCapKg" > 0 AND "volumeCapM3" > 0 AND "kmPerL" > 0 AND "weeklyFuelQuotaL" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_check_1" CHECK ("unitWeightKg" > 0 AND "unitVolumeM3" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_check_1" CHECK ("weightG" > 0 AND "volumeL" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_check_2" CHECK ("deferredCount" >= 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_check_1" CHECK ("qtyOrdered" >= 0 AND "qtyLoaded" >= 0 AND "qtyDelivered" >= 0 AND "qtyReceived" >= 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_check_2" CHECK ("unitWeightKg" > 0 AND "unitVolumeM3" > 0);
ALTER TABLE "districts" ADD CONSTRAINT "districts_check_1" CHECK ("freeFlowKmh" > 0 AND "depotToDistrictKm" >= 0 AND "depotToDistrictFreeflowMin" >= 0 AND "interStopKm" >= 0 AND "interStopFreeflowMin" >= 0);
ALTER TABLE "service_allowances" ADD CONSTRAINT "service_allowances_check_1" CHECK (minutes >= 0);
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_check_1" CHECK (dow BETWEEN 0 AND 6 AND "isoWeek" BETWEEN 1 AND 53 AND "festivalRamp" >= 0);
ALTER TABLE "weekly_demand_history" ADD CONSTRAINT "weekly_demand_history_check_1" CHECK ("isoWeek" BETWEEN 1 AND 53 AND "totalVolumeM3" >= 0 AND "chilledVolumeM3" >= 0 AND "chilledVolumeM3" <= "totalVolumeM3");
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_check_1" CHECK ("windowOpen" >= 0 AND "windowClose" <= 1440 AND "windowOpen" < "windowClose");
ALTER TABLE "planning_days" ADD CONSTRAINT "planning_days_check_1" CHECK ("currentVersion" >= 0);
ALTER TABLE "plan_drafts" ADD CONSTRAINT "plan_drafts_check_1" CHECK (revision >= 0 AND "baseVersion" >= 0);
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_check_1" CHECK (version > 0 AND "draftRevision" >= 0);
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_check_1" CHECK ("schemaVersion" > 0);
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_check_2" CHECK (("deviceId" IS NULL AND "deviceSeq" IS NULL) OR ("deviceId" IS NOT NULL AND "deviceSeq" IS NOT NULL AND "deviceSeq" > 0));
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_check_3" CHECK (source <> 'FIELD' OR ("clientEventId" IS NOT NULL AND "deviceId" IS NOT NULL AND "deviceSeq" IS NOT NULL));
ALTER TABLE "devices" ADD CONSTRAINT "devices_check_1" CHECK ("pendingCount" >= 0);
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_check_1" CHECK (size >= 0 AND size = octet_length(bytes));
ALTER TABLE "feed_counter" ADD CONSTRAINT "feed_counter_check_1" CHECK (singleton = true AND head >= 0);
ALTER TABLE "demo_state" ADD CONSTRAINT "demo_state_check_1" CHECK (singleton = true AND "resetEpoch" >= 0);
ALTER TABLE "change_feed" ADD CONSTRAINT "change_feed_check_1" CHECK (seq > 0);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_check_1" CHECK ("userId" IS NOT NULL OR (role IS NOT NULL AND (depot IS NOT NULL OR "vehicleId" IS NOT NULL OR "outletId" IS NOT NULL)));
ALTER TABLE "deferrals" ADD CONSTRAINT "deferrals_check_1" CHECK ("planVersion" > 0 AND "daysUnserved" >= 0 AND "consecutiveDeferrals" >= 0);
ALTER TABLE "trips" ADD CONSTRAINT "trips_check_1" CHECK ("tripNo" IN (1,2));
ALTER TABLE "trips" ADD CONSTRAINT "trips_check_2" CHECK ("plannedDepart" BETWEEN 0 AND 1439 AND "plannedMinutes" > 0 AND km >= 0 AND litres >= 0);
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_check_1" CHECK (seq > 0 AND "etaMin" >= 0 AND "serviceMin" >= 0);
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_check_2" CHECK ("windowOpen" >= 0 AND "windowClose" <= 1440 AND "windowOpen" < "windowClose");
ALTER TABLE "road_conditions" ADD CONSTRAINT "road_conditions_check_1" CHECK ("disruptionIndex" > 0 AND "disruptionIndex" <= 100);
ALTER TABLE "traffic_speeds" ADD CONSTRAINT "traffic_speeds_check_1" CHECK (hour BETWEEN 0 AND 23 AND "speedIndex" > 0 AND "speedIndex" <= 100);

-- This is infrastructure initialization, not application/reference seed data.
INSERT INTO feed_counter (id, singleton, head) VALUES (gen_random_uuid(), true, 0);
CREATE TRIGGER feed_counter_no_delete BEFORE DELETE ON feed_counter
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
