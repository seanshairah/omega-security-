-- Additive only: new coordinate sources for the site picker, and the table that tracks
-- "ask the guard phone for a fresh fix" requests. No existing row is touched.
ALTER TYPE "CoordinatesSource" ADD VALUE IF NOT EXISTS 'BROWSER';
ALTER TYPE "CoordinatesSource" ADD VALUE IF NOT EXISTS 'GUARD_DEVICE';

-- CreateEnum
CREATE TYPE "LocationRequestStatus" AS ENUM ('PENDING', 'DELIVERED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LocationRequestFailure" AS ENUM ('PERMISSION_DENIED', 'LOCATION_DISABLED', 'GPS_TIMEOUT', 'POOR_ACCURACY', 'DEVICE_UNAVAILABLE', 'REQUEST_EXPIRED', 'SERVICE_RESTRICTED', 'INTERNAL_ERROR');

-- CreateTable
CREATE TABLE "DeviceLocationRequest" (
    "id" TEXT NOT NULL,
    "gatewayDeviceId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "requestedById" TEXT,
    "locationId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'CHECK',
    "status" "LocationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxAccuracyM" INTEGER NOT NULL DEFAULT 100,
    "requireFreshFix" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "provider" TEXT,
    "capturedAt" TIMESTAMP(3),
    "failureReason" "LocationRequestFailure",
    "failureDetail" TEXT,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "resultEventId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceLocationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLocationRequest_resultEventId_key" ON "DeviceLocationRequest"("resultEventId");

-- CreateIndex
CREATE INDEX "DeviceLocationRequest_gatewayDeviceId_status_idx" ON "DeviceLocationRequest"("gatewayDeviceId", "status");

-- CreateIndex
CREATE INDEX "DeviceLocationRequest_guardId_requestedAt_idx" ON "DeviceLocationRequest"("guardId", "requestedAt");

-- CreateIndex
CREATE INDEX "DeviceLocationRequest_status_expiresAt_idx" ON "DeviceLocationRequest"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceLocationRequest" ADD CONSTRAINT "DeviceLocationRequest_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLocationRequest" ADD CONSTRAINT "DeviceLocationRequest_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLocationRequest" ADD CONSTRAINT "DeviceLocationRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

