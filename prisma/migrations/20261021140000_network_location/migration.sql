-- CreateEnum
CREATE TYPE "NetworkLocationResult" AS ENUM ('NETWORK_VERIFIED_INSIDE', 'NETWORK_VERIFIED_OUTSIDE', 'NETWORK_PARTIAL_MATCH', 'NETWORK_LOCATION_STALE', 'NETWORK_LOCATION_UNAVAILABLE', 'NETWORK_PROVIDER_UNAVAILABLE', 'NETWORK_NOT_AUTHORISED', 'NETWORK_UNSUPPORTED', 'NETWORK_ERROR');

-- CreateEnum
CREATE TYPE "NetworkCheckTrigger" AS ENUM ('SHIFT_START', 'MID_SHIFT', 'SHIFT_END', 'INCOMING_CALL', 'AFTER_WELFARE_CALL', 'MANUAL', 'RETRY_UNCERTAIN', 'ANDROID_FALLBACK');

-- AlterEnum
ALTER TYPE "CheckInType" ADD VALUE 'NETWORK_LOCATION';

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "networkRadiusM" INTEGER,
ADD COLUMN     "networkVerifyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NetworkLocationCheck" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "guardId" TEXT NOT NULL,
    "shiftId" TEXT,
    "locationId" TEXT,
    "trigger" "NetworkCheckTrigger" NOT NULL,
    "requestedById" TEXT,
    "operator" "MobileOperator" NOT NULL DEFAULT 'UNKNOWN',
    "provider" TEXT NOT NULL,
    "requestSent" BOOLEAN NOT NULL DEFAULT false,
    "result" "NetworkLocationResult" NOT NULL,
    "reason" TEXT,
    "areaLatitude" DOUBLE PRECISION,
    "areaLongitude" DOUBLE PRECISION,
    "areaRadiusM" INTEGER,
    "maxAgeSeconds" INTEGER,
    "observedAt" TIMESTAMP(3),
    "matchRate" INTEGER,
    "uncertaintyM" INTEGER,
    "authorisationRef" TEXT,
    "providerRef" TEXT,
    "costUnits" DOUBLE PRECISION,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NetworkLocationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NetworkLocationCheck_dedupeKey_key" ON "NetworkLocationCheck"("dedupeKey");

-- CreateIndex
CREATE INDEX "NetworkLocationCheck_guardId_requestedAt_idx" ON "NetworkLocationCheck"("guardId", "requestedAt");

-- CreateIndex
CREATE INDEX "NetworkLocationCheck_shiftId_requestedAt_idx" ON "NetworkLocationCheck"("shiftId", "requestedAt");

-- AddForeignKey
ALTER TABLE "NetworkLocationCheck" ADD CONSTRAINT "NetworkLocationCheck_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkLocationCheck" ADD CONSTRAINT "NetworkLocationCheck_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

