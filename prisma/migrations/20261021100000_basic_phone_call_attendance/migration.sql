-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('BASIC', 'ANDROID', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MobileOperator" AS ENUM ('ECONET', 'NETONE', 'TELECEL', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttendanceChannel" AS ENUM ('CALL', 'SMS', 'APP');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('CHECK_IN', 'WELFARE', 'CHECK_OUT', 'PRESENCE');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('CALL', 'MISSED_CALL', 'SMS', 'GPS', 'NETWORK', 'IVR', 'MANUAL');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('CONFIRMED', 'PROVISIONAL', 'PENDING', 'REJECTED');

-- AlterTable
ALTER TABLE "Guard" ADD COLUMN     "alternatePhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "assignedGatewayId" TEXT,
ADD COLUMN     "callAttendanceEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ivrAttendanceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mobileOperator" "MobileOperator" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "networkLocationConsentAt" TIMESTAMP(3),
ADD COLUMN     "networkLocationEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneType" "PhoneType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "preferredAttendance" "AttendanceChannel" NOT NULL DEFAULT 'SMS',
ADD COLUMN     "smsAttendanceEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AttendanceEvidence" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "source" "EvidenceSource" NOT NULL,
    "status" "EvidenceStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callLogId" TEXT,
    "smsMessageId" TEXT,
    "gatewayDeviceId" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvidence_dedupeKey_key" ON "AttendanceEvidence"("dedupeKey");

-- CreateIndex
CREATE INDEX "AttendanceEvidence_shiftId_occurredAt_idx" ON "AttendanceEvidence"("shiftId", "occurredAt");

-- CreateIndex
CREATE INDEX "AttendanceEvidence_guardId_occurredAt_idx" ON "AttendanceEvidence"("guardId", "occurredAt");

-- CreateIndex
CREATE INDEX "AttendanceEvidence_status_idx" ON "AttendanceEvidence"("status");

-- AddForeignKey
ALTER TABLE "Guard" ADD CONSTRAINT "Guard_assignedGatewayId_fkey" FOREIGN KEY ("assignedGatewayId") REFERENCES "GatewayDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvidence" ADD CONSTRAINT "AttendanceEvidence_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvidence" ADD CONSTRAINT "AttendanceEvidence_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvidence" ADD CONSTRAINT "AttendanceEvidence_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: a guard with a registered guard APK carries an Android phone. Everyone else stays
-- UNKNOWN until an administrator says otherwise; nothing is guessed from the number.
UPDATE "Guard" SET "phoneType" = 'ANDROID' WHERE "deviceKind" = 'ANDROID_GUARD' AND "phoneType" = 'UNKNOWN';
