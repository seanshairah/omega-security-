-- Guard devices, GPS verification and geofencing. Purely additive.
CREATE TYPE "LocationVerification" AS ENUM ('NOT_APPLICABLE', 'VERIFIED', 'EXCEPTION', 'UNAVAILABLE');
CREATE TYPE "GuardDeviceKind" AS ENUM ('FEATURE_PHONE', 'ANDROID_GUARD');
CREATE TYPE "DeviceMode" AS ENUM ('OPERATIONS_GATEWAY', 'GUARD');
CREATE TYPE "LocationState" AS ENUM ('INSIDE', 'OUTSIDE', 'UNKNOWN');
CREATE TYPE "LocationEventType" AS ENUM ('SHIFT_STARTED', 'LOCATION_CHECK', 'LOCATION_EXIT', 'LOCATION_OUTSIDE', 'LOCATION_RETURNED', 'LOCATION_UNAVAILABLE', 'LOCATION_VERIFICATION_OVERDUE', 'LOCATION_CALL');
CREATE TYPE "SyncStatus" AS ENUM ('LIVE', 'SYNCED', 'SYNCED_LATE');

ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_VERIFIED';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_EXCEPTION';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_INSIDE';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_EXIT';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_OUTSIDE';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_RETURNED';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_UNAVAILABLE';
ALTER TYPE "CheckInType" ADD VALUE 'LOCATION_OVERDUE';

ALTER TABLE "Location" ADD COLUMN "geofenceRadiusM" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "Guard" ADD COLUMN "deviceKind" "GuardDeviceKind" NOT NULL DEFAULT 'FEATURE_PHONE';
ALTER TABLE "Attendance" ADD COLUMN "locationVerification" "LocationVerification" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "locationVerifiedAt" TIMESTAMP(3);

ALTER TABLE "GatewayDevice" ADD COLUMN "mode" "DeviceMode" NOT NULL DEFAULT 'OPERATIONS_GATEWAY',
  ADD COLUMN "guardId" TEXT,
  ADD COLUMN "locationPermission" TEXT,
  ADD COLUMN "callPermission" TEXT,
  ADD COLUMN "monitoringState" TEXT,
  ADD COLUMN "mockLocationSeen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastLatitude" DOUBLE PRECISION,
  ADD COLUMN "lastLongitude" DOUBLE PRECISION,
  ADD COLUMN "lastAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "lastLocationAt" TIMESTAMP(3),
  ADD COLUMN "lastLocationState" "LocationState";
ALTER TABLE "GatewayDevice" ADD CONSTRAINT "GatewayDevice_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "GatewayDevice_guardId_idx" ON "GatewayDevice"("guardId");

ALTER TABLE "CallLog" ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "locationState" "LocationState",
  ADD COLUMN "correlatedCallId" TEXT;

CREATE TABLE "LocationEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "gatewayDeviceId" TEXT NOT NULL,
  "guardId" TEXT,
  "shiftId" TEXT,
  "locationId" TEXT,
  "eventType" "LocationEventType" NOT NULL,
  "locationState" "LocationState" NOT NULL DEFAULT 'UNKNOWN',
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracyM" DOUBLE PRECISION,
  "distanceM" DOUBLE PRECISION,
  "geofenceRadiusM" INTEGER,
  "provider" TEXT,
  "speed" DOUBLE PRECISION,
  "bearing" DOUBLE PRECISION,
  "mock" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "durationOutsideSeconds" INTEGER,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "syncStatus" "SyncStatus" NOT NULL DEFAULT 'LIVE',
  "simulated" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  CONSTRAINT "LocationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocationEvent_eventId_key" ON "LocationEvent"("eventId");
CREATE INDEX "LocationEvent_shiftId_occurredAt_idx" ON "LocationEvent"("shiftId", "occurredAt");
CREATE INDEX "LocationEvent_guardId_occurredAt_idx" ON "LocationEvent"("guardId", "occurredAt");
CREATE INDEX "LocationEvent_gatewayDeviceId_occurredAt_idx" ON "LocationEvent"("gatewayDeviceId", "occurredAt");
CREATE INDEX "LocationEvent_eventType_idx" ON "LocationEvent"("eventType");
CREATE INDEX "LocationEvent_occurredAt_idx" ON "LocationEvent"("occurredAt");
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
