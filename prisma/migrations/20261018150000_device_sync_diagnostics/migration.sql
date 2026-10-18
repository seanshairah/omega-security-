-- Sync-engine and separated monitoring diagnostics reported by guard phones. Purely additive.
ALTER TABLE "GatewayDevice" ADD COLUMN "shiftState" TEXT,
  ADD COLUMN "gpsState" TEXT,
  ADD COLUMN "gpsReason" TEXT,
  ADD COLUMN "syncState" TEXT,
  ADD COLUMN "queuedEvents" INTEGER,
  ADD COLUMN "failedEvents" INTEGER,
  ADD COLUMN "oldestPendingSeconds" INTEGER,
  ADD COLUMN "lastEventSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncError" TEXT,
  ADD COLUMN "lastSyncTrigger" TEXT;
