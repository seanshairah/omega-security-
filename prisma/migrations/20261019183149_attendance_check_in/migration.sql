-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('AWAITING', 'CALL_RECEIVED', 'GPS_PENDING', 'VERIFIED_ON_TIME', 'VERIFIED_WITHIN_GRACE', 'VERIFIED_LATE', 'OUTSIDE_AREA', 'LOCATION_UNCERTAIN', 'LOCATION_UNAVAILABLE', 'SITE_NOT_CONFIGURED', 'MISSED', 'MANUAL_REVIEW', 'MANUALLY_APPROVED', 'MANUALLY_REJECTED');

-- CreateEnum
CREATE TYPE "CheckInSourceKind" AS ENUM ('NONE', 'CALL_GPS', 'MONITORING', 'SMS_ONLY', 'MANUAL');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "checkInGraceMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "checkInGraceMinutes" INTEGER;

-- CreateTable
CREATE TABLE "AttendanceCheckIn" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "gatewayDeviceId" TEXT,
    "status" "CheckInStatus" NOT NULL DEFAULT 'AWAITING',
    "source" "CheckInSourceKind" NOT NULL DEFAULT 'NONE',
    "callLogId" TEXT,
    "locationRequestId" TEXT,
    "locationEventId" TEXT,
    "scheduledStartAt" TIMESTAMP(3) NOT NULL,
    "callAt" TIMESTAMP(3),
    "gpsCapturedAt" TIMESTAMP(3),
    "verifiedArrivalAt" TIMESTAMP(3),
    "geofenceState" "LocationState",
    "geofenceReason" TEXT,
    "accuracyM" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "graceMinutes" INTEGER NOT NULL DEFAULT 5,
    "minutesAfterStart" INTEGER,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "exceptionReason" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "previousStatus" "CheckInStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCheckIn_shiftId_key" ON "AttendanceCheckIn"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCheckIn_locationRequestId_key" ON "AttendanceCheckIn"("locationRequestId");

-- CreateIndex
CREATE INDEX "AttendanceCheckIn_status_idx" ON "AttendanceCheckIn"("status");

-- CreateIndex
CREATE INDEX "AttendanceCheckIn_guardId_scheduledStartAt_idx" ON "AttendanceCheckIn"("guardId", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "AttendanceCheckIn_scheduledStartAt_idx" ON "AttendanceCheckIn"("scheduledStartAt");

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_gatewayDeviceId_fkey" FOREIGN KEY ("gatewayDeviceId") REFERENCES "GatewayDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_locationRequestId_fkey" FOREIGN KEY ("locationRequestId") REFERENCES "DeviceLocationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCheckIn" ADD CONSTRAINT "AttendanceCheckIn_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
