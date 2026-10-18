-- Release hardening diagnostics reported by phones. Purely additive.
ALTER TABLE "GatewayDevice" ADD COLUMN "secureStorage" BOOLEAN,
  ADD COLUMN "buildType" TEXT;
