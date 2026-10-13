-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "ShiftPattern" AS ENUM ('DAY_8', 'NIGHT_8', 'DAY_12', 'NIGHT_12', 'CUSTOM');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'AWAITING_ARRIVAL', 'ON_DUTY', 'LATE', 'NOT_CONFIRMED', 'ASSISTANCE', 'INCIDENT', 'CRITICAL', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PendingPrompt" AS ENUM ('NONE', 'ARRIVAL', 'WELFARE', 'INCIDENT_DESCRIPTION', 'COMPLETION');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'PRESENT', 'LATE', 'NOT_REPORTED', 'COMPLETED', 'LEFT_EARLY', 'STILL_ON_DUTY', 'INCIDENT');

-- CreateEnum
CREATE TYPE "CheckInType" AS ENUM ('SHIFT_STARTED', 'ARRIVAL_SMS_SENT', 'ARRIVAL_REMINDER_SENT', 'ARRIVAL_CONFIRMED', 'ARRIVAL_DENIED', 'ARRIVAL_ESCALATED', 'WELFARE_SMS_SENT', 'WELFARE_OK', 'WELFARE_ASSISTANCE', 'WELFARE_INCIDENT', 'WELFARE_MISSED', 'INCIDENT_REPORTED', 'EMERGENCY', 'HANDOVER_NOTICE', 'COMPLETION_SMS_SENT', 'COMPLETION_CONFIRMED', 'COMPLETION_DENIED', 'COMPLETION_TIMEOUT', 'SHIFT_COMPLETED', 'SHIFT_MISSED', 'SHIFT_CANCELLED', 'ADMIN_NOTE', 'UNRECOGNISED_REPLY');

-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('SMS', 'SYSTEM', 'ADMIN', 'APP');

-- CreateEnum
CREATE TYPE "WelfareResponse" AS ENUM ('PENDING', 'WELL', 'ASSISTANCE', 'INCIDENT', 'NO_RESPONSE');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('THEFT', 'UNAUTHORIZED_ACCESS', 'MEDICAL_EMERGENCY', 'FIRE', 'VIOLENCE', 'EQUIPMENT_PROBLEM', 'SUSPICIOUS_ACTIVITY', 'ASSISTANCE_REQUEST', 'EMERGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('SMS', 'ADMIN', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "SmsDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('ARRIVAL', 'ARRIVAL_REMINDER', 'WELFARE', 'INCIDENT', 'ASSISTANCE', 'COMPLETION', 'HANDOVER', 'EMERGENCY', 'CLARIFICATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "phone" TEXT,
    "title" TEXT,
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteType" TEXT,
    "address" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "requiredGuards" INTEGER NOT NULL DEFAULT 1,
    "shiftPattern" "ShiftPattern" NOT NULL DEFAULT 'NIGHT_12',
    "supervisorId" TEXT,
    "specialInstructions" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guard" (
    "id" TEXT NOT NULL,
    "guardNo" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nationalId" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'MALE',
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "dateEmployed" TIMESTAMP(3),
    "supervisorId" TEXT,
    "homeLocationId" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRecurrence" (
    "id" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "recurrenceId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "instructions" TEXT,
    "notes" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "pendingPrompt" "PendingPrompt" NOT NULL DEFAULT 'NONE',
    "arrivalSmsSentAt" TIMESTAMP(3),
    "arrivalReminderSentAt" TIMESTAMP(3),
    "arrivalEscalatedAt" TIMESTAMP(3),
    "welfareSmsSentAt" TIMESTAMP(3),
    "welfareMissedAt" TIMESTAMP(3),
    "handoverSmsSentAt" TIMESTAMP(3),
    "completionSmsSentAt" TIMESTAMP(3),
    "completionTimedOutAt" TIMESTAMP(3),
    "emergencyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "arrivalConfirmedAt" TIMESTAMP(3),
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "completionConfirmedAt" TIMESTAMP(3),
    "missedChecks" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCheckIn" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "type" "CheckInType" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "CheckInSource" NOT NULL DEFAULT 'SYSTEM',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "smsMessageId" TEXT,

    CONSTRAINT "ShiftCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelfareCheck" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "response" "WelfareResponse" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "WelfareCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "incidentNo" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "IncidentCategory" NOT NULL DEFAULT 'OTHER',
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "source" "IncidentSource" NOT NULL DEFAULT 'ADMIN',
    "supervisorId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "direction" "SmsDirection" NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "SmsType" NOT NULL DEFAULT 'GENERAL',
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "interpretedAs" TEXT,
    "guardId" TEXT,
    "shiftId" TEXT,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "group" TEXT NOT NULL DEFAULT 'automation',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "guardId" TEXT,
    "shiftId" TEXT,
    "incidentId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "Location_clientId_idx" ON "Location"("clientId");

-- CreateIndex
CREATE INDEX "Location_active_idx" ON "Location"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Guard_guardNo_key" ON "Guard"("guardNo");

-- CreateIndex
CREATE UNIQUE INDEX "Guard_phone_key" ON "Guard"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Guard_nationalId_key" ON "Guard"("nationalId");

-- CreateIndex
CREATE INDEX "Guard_lastName_firstName_idx" ON "Guard"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Guard_active_idx" ON "Guard"("active");

-- CreateIndex
CREATE INDEX "Guard_homeLocationId_idx" ON "Guard"("homeLocationId");

-- CreateIndex
CREATE INDEX "ShiftRecurrence_active_idx" ON "ShiftRecurrence"("active");

-- CreateIndex
CREATE INDEX "Shift_startAt_idx" ON "Shift"("startAt");

-- CreateIndex
CREATE INDEX "Shift_endAt_idx" ON "Shift"("endAt");

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- CreateIndex
CREATE INDEX "Shift_guardId_startAt_idx" ON "Shift"("guardId", "startAt");

-- CreateIndex
CREATE INDEX "Shift_locationId_startAt_idx" ON "Shift"("locationId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_shiftId_key" ON "Attendance"("shiftId");

-- CreateIndex
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");

-- CreateIndex
CREATE INDEX "ShiftCheckIn_shiftId_at_idx" ON "ShiftCheckIn"("shiftId", "at");

-- CreateIndex
CREATE INDEX "ShiftCheckIn_guardId_at_idx" ON "ShiftCheckIn"("guardId", "at");

-- CreateIndex
CREATE INDEX "WelfareCheck_shiftId_idx" ON "WelfareCheck"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_incidentNo_key" ON "Incident"("incidentNo");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_occurredAt_idx" ON "Incident"("occurredAt");

-- CreateIndex
CREATE INDEX "Incident_guardId_idx" ON "Incident"("guardId");

-- CreateIndex
CREATE INDEX "Incident_locationId_idx" ON "Incident"("locationId");

-- CreateIndex
CREATE INDEX "SmsMessage_createdAt_idx" ON "SmsMessage"("createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_guardId_createdAt_idx" ON "SmsMessage"("guardId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_shiftId_idx" ON "SmsMessage"("shiftId");

-- CreateIndex
CREATE INDEX "SmsMessage_type_idx" ON "SmsMessage"("type");

-- CreateIndex
CREATE INDEX "SmsMessage_direction_idx" ON "SmsMessage"("direction");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_key_key" ON "MessageTemplate"("key");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guard" ADD CONSTRAINT "Guard_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guard" ADD CONSTRAINT "Guard_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRecurrence" ADD CONSTRAINT "ShiftRecurrence_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRecurrence" ADD CONSTRAINT "ShiftRecurrence_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRecurrence" ADD CONSTRAINT "ShiftRecurrence_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "ShiftRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCheckIn" ADD CONSTRAINT "ShiftCheckIn_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCheckIn" ADD CONSTRAINT "ShiftCheckIn_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCheckIn" ADD CONSTRAINT "ShiftCheckIn_smsMessageId_fkey" FOREIGN KEY ("smsMessageId") REFERENCES "SmsMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelfareCheck" ADD CONSTRAINT "WelfareCheck_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
