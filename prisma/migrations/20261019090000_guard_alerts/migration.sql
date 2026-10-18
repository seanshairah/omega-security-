-- Guard-initiated alerts and status messages from the Android app. Purely additive.
CREATE TYPE "GuardAlertType" AS ENUM ('EMERGENCY', 'NEED_ASSISTANCE', 'INCIDENT_REPORT', 'SECURITY_ALERT', 'RUNNING_LATE', 'STATUS_UPDATE', 'SHIFT_OK', 'HANDOVER');
CREATE TYPE "GuardAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
ALTER TYPE "IncidentSource" ADD VALUE 'APP';
ALTER TYPE "CheckInType" ADD VALUE 'SECURITY_ALERT';
ALTER TYPE "CheckInType" ADD VALUE 'RUNNING_LATE';
ALTER TYPE "CheckInType" ADD VALUE 'STATUS_UPDATE';
ALTER TYPE "CheckInType" ADD VALUE 'GUARD_OK';
ALTER TYPE "CheckInType" ADD VALUE 'ALERT_ACKNOWLEDGED';

CREATE TABLE "GuardAlert" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "guardId" TEXT NOT NULL,
  "gatewayDeviceId" TEXT NOT NULL,
  "shiftId" TEXT,
  "locationId" TEXT,
  "type" "GuardAlertType" NOT NULL,
  "status" "GuardAlertStatus" NOT NULL DEFAULT 'OPEN',
  "requiresAck" BOOLEAN NOT NULL DEFAULT true,
  "message" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracyM" DOUBLE PRECISION,
  "locationState" "LocationState",
  "locationAgeSeconds" INTEGER,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "syncStatus" "SyncStatus" NOT NULL DEFAULT 'LIVE',
  "simulated" BOOLEAN NOT NULL DEFAULT false,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "acknowledgementNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolutionNote" TEXT,
  "incidentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuardAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuardAlert_eventId_key" ON "GuardAlert"("eventId");
CREATE INDEX "GuardAlert_status_idx" ON "GuardAlert"("status");
CREATE INDEX "GuardAlert_guardId_occurredAt_idx" ON "GuardAlert"("guardId", "occurredAt");
CREATE INDEX "GuardAlert_shiftId_idx" ON "GuardAlert"("shiftId");
CREATE INDEX "GuardAlert_occurredAt_idx" ON "GuardAlert"("occurredAt");
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuardAlert" ADD CONSTRAINT "GuardAlert_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
