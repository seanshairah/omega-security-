-- Android call gateway: devices, raw events and call logs. Purely additive.
ALTER TYPE "CheckInType" ADD VALUE 'CALL_INCOMING';
ALTER TYPE "CheckInType" ADD VALUE 'CALL_ANSWERED';
ALTER TYPE "CheckInType" ADD VALUE 'CALL_ENDED';
ALTER TYPE "CheckInType" ADD VALUE 'CALL_MISSED';
ALTER TYPE "CheckInType" ADD VALUE 'CALL_OUTGOING';

CREATE TYPE "GatewayStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DISABLED', 'REVOKED');
CREATE TYPE "GatewayActivation" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
CREATE TYPE "CallDirection" AS ENUM ('INCOMING', 'OUTGOING');
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ANSWERED', 'MISSED', 'ENDED', 'FAILED', 'UNKNOWN');

CREATE TABLE "GatewayDevice" (
  "id" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "locationId" TEXT,
  "status" "GatewayStatus" NOT NULL DEFAULT 'OFFLINE',
  "activationStatus" "GatewayActivation" NOT NULL DEFAULT 'PENDING',
  "activationCode" TEXT,
  "activationExpiresAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "tokenHash" TEXT,
  "tokenIssuedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "lastIp" TEXT,
  "androidVersion" TEXT,
  "appVersion" TEXT,
  "deviceModel" TEXT,
  "batteryLevel" INTEGER,
  "networkType" TEXT,
  "lastCallAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "GatewayDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatewayDevice_activationCode_key" ON "GatewayDevice"("activationCode");
CREATE UNIQUE INDEX "GatewayDevice_tokenHash_key" ON "GatewayDevice"("tokenHash");
CREATE INDEX "GatewayDevice_status_idx" ON "GatewayDevice"("status");
CREATE INDEX "GatewayDevice_locationId_idx" ON "GatewayDevice"("locationId");
CREATE INDEX "GatewayDevice_lastSeenAt_idx" ON "GatewayDevice"("lastSeenAt");
ALTER TABLE "GatewayDevice" ADD CONSTRAINT "GatewayDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GatewayEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "gatewayDeviceId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "callId" TEXT,
  "phoneNumber" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB,
  "outcome" TEXT,
  CONSTRAINT "GatewayEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatewayEvent_eventId_key" ON "GatewayEvent"("eventId");
CREATE INDEX "GatewayEvent_gatewayDeviceId_receivedAt_idx" ON "GatewayEvent"("gatewayDeviceId", "receivedAt");
CREATE INDEX "GatewayEvent_eventType_idx" ON "GatewayEvent"("eventType");
ALTER TABLE "GatewayEvent" ADD CONSTRAINT "GatewayEvent_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CallLog" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "gatewayDeviceId" TEXT NOT NULL,
  "guardId" TEXT,
  "locationId" TEXT,
  "clientId" TEXT,
  "shiftId" TEXT,
  "phoneNumber" TEXT NOT NULL,
  "normalizedPhoneNumber" TEXT NOT NULL,
  "direction" "CallDirection" NOT NULL DEFAULT 'INCOMING',
  "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "unknownCaller" BOOLEAN NOT NULL DEFAULT false,
  "unknownResolution" TEXT,
  "simulated" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CallLog_gatewayDeviceId_callId_key" ON "CallLog"("gatewayDeviceId", "callId");
CREATE INDEX "CallLog_startedAt_idx" ON "CallLog"("startedAt");
CREATE INDEX "CallLog_status_idx" ON "CallLog"("status");
CREATE INDEX "CallLog_guardId_startedAt_idx" ON "CallLog"("guardId", "startedAt");
CREATE INDEX "CallLog_locationId_startedAt_idx" ON "CallLog"("locationId", "startedAt");
CREATE INDEX "CallLog_normalizedPhoneNumber_idx" ON "CallLog"("normalizedPhoneNumber");
CREATE INDEX "CallLog_unknownCaller_idx" ON "CallLog"("unknownCaller");
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
