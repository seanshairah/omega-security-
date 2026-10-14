-- Client site-status SMS updates
ALTER TYPE "SmsType" ADD VALUE 'CLIENT_UPDATE';
ALTER TYPE "CheckInType" ADD VALUE 'CLIENT_NOTIFIED';

ALTER TABLE "Location" ADD COLUMN "clientUpdates" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientUpdatePhone" TEXT,
  ADD COLUMN "notifyClientArrival" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyClientWelfare" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyClientCompletion" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Incident" ADD COLUMN "clientNotifiedAt" TIMESTAMP(3);

ALTER TABLE "SmsMessage" ADD COLUMN "clientId" TEXT;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SmsMessage_clientId_createdAt_idx" ON "SmsMessage"("clientId", "createdAt");
