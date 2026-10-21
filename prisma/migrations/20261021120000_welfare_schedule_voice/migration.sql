-- CreateEnum
CREATE TYPE "WelfareChannel" AS ENUM ('SMS', 'VOICE', 'GATEWAY_CALL');

-- CreateEnum
CREATE TYPE "WelfareCallStatus" AS ENUM ('CALL_SCHEDULED', 'CALL_INITIATED', 'CALL_RINGING', 'CALL_ANSWERED', 'RESPONSE_CONFIRMED', 'NO_ANSWER', 'BUSY', 'FAILED', 'ESCALATED');

-- AlterEnum
ALTER TYPE "IncidentSource" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "Guard" ADD COLUMN     "welfareExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "welfareChannel" "WelfareChannel" NOT NULL DEFAULT 'SMS',
ADD COLUMN     "welfareIntervalMinutes" INTEGER,
ADD COLUMN     "welfareMaxAttempts" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "welfareRetryMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "welfareSmsFallback" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "welfareTimes" TEXT;

-- AlterTable
ALTER TABLE "WelfareCheck" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "callRequestId" TEXT,
ADD COLUMN     "callStatus" "WelfareCallStatus",
ADD COLUMN     "channel" "WelfareChannel" NOT NULL DEFAULT 'SMS',
ADD COLUMN     "digits" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerCallId" TEXT,
ADD COLUMN     "scheduleKey" TEXT,
ADD COLUMN     "smsFallbackAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VoiceWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceWebhookEvent_provider_eventId_key" ON "VoiceWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WelfareCheck_scheduleKey_key" ON "WelfareCheck"("scheduleKey");

-- CreateIndex
CREATE UNIQUE INDEX "WelfareCheck_providerCallId_key" ON "WelfareCheck"("providerCallId");

