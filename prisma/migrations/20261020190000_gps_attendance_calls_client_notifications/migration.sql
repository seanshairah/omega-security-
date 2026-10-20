-- CreateEnum
CREATE TYPE "CallRequestStatus" AS ENUM ('QUEUED', 'DELIVERED', 'AWAITING_CONFIRMATION', 'DIALING', 'CONNECTED', 'COMPLETED', 'NO_ANSWER', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClientNotificationType" AS ENUM ('GUARD_ARRIVED', 'GUARD_VERIFIED', 'GUARD_LATE', 'GUARD_ABSENT', 'MISSED_CHECK_IN', 'GUARD_OUTSIDE', 'EMERGENCY', 'ASSISTANCE', 'SHIFT_COMPLETED', 'REPLACEMENT_DISPATCHED', 'SITE_STATUS', 'WELFARE_OK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ClientNotificationStatus" AS ENUM ('PENDING_APPROVAL', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "CheckInSourceKind" ADD VALUE 'AUTO_GPS';

-- AlterEnum
ALTER TYPE "CheckInStatus" ADD VALUE 'DEVICE_OFFLINE';

-- AlterTable
ALTER TABLE "AttendanceCheckIn" ADD COLUMN     "autoRequestedAt" TIMESTAMP(3),
ADD COLUMN     "callOutstandingNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "callRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GatewayDevice" ADD COLUMN     "placeCallPermission" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "clientUpdateEmail" TEXT,
ADD COLUMN     "defaultGatewayId" TEXT,
ADD COLUMN     "notifyClientAbsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyClientEmergency" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyClientLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyClientOutside" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SchedulerLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastSource" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerLease_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "CallRequest" (
    "id" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "gatewayDeviceId" TEXT NOT NULL,
    "requestedById" TEXT,
    "shiftId" TEXT,
    "incidentId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "reason" TEXT,
    "status" "CallRequestStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "shownAt" TIMESTAMP(3),
    "dialedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "failureReason" TEXT,
    "callLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNotification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "locationId" TEXT,
    "guardId" TEXT,
    "shiftId" TEXT,
    "incidentId" TEXT,
    "type" "ClientNotificationType" NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'SMS',
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ClientNotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "failureReason" TEXT,
    "sentById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rule" TEXT,
    "dedupeKey" TEXT,
    "eventRef" TEXT,
    "smsMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallRequest_idempotencyKey_key" ON "CallRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CallRequest_callLogId_key" ON "CallRequest"("callLogId");

-- CreateIndex
CREATE INDEX "CallRequest_gatewayDeviceId_status_idx" ON "CallRequest"("gatewayDeviceId", "status");

-- CreateIndex
CREATE INDEX "CallRequest_guardId_requestedAt_idx" ON "CallRequest"("guardId", "requestedAt");

-- CreateIndex
CREATE INDEX "CallRequest_status_expiresAt_idx" ON "CallRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotification_dedupeKey_key" ON "ClientNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "ClientNotification_clientId_createdAt_idx" ON "ClientNotification"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientNotification_locationId_createdAt_idx" ON "ClientNotification"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientNotification_status_idx" ON "ClientNotification"("status");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_defaultGatewayId_fkey" FOREIGN KEY ("defaultGatewayId") REFERENCES "GatewayDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRequest" ADD CONSTRAINT "CallRequest_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRequest" ADD CONSTRAINT "CallRequest_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRequest" ADD CONSTRAINT "CallRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRequest" ADD CONSTRAINT "CallRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

