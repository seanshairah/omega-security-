-- Duty-site map picker, coordinate provenance, config versioning and shift-level geofence overrides. Purely additive.
CREATE TYPE "CoordinatesSource" AS ENUM ('MAP', 'MANUAL', 'TEST');

ALTER TABLE "Location" ADD COLUMN "coordinatesSource" "CoordinatesSource",
  ADD COLUMN "coordinatesUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "coordinatesVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "placeId" TEXT,
  ADD COLUMN "configVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Shift" ADD COLUMN "geofenceLatitude" DOUBLE PRECISION,
  ADD COLUMN "geofenceLongitude" DOUBLE PRECISION,
  ADD COLUMN "geofenceRadiusM" INTEGER,
  ADD COLUMN "geofenceNote" TEXT,
  ADD COLUMN "configVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "GatewayDevice" ADD COLUMN "configVersionApplied" TEXT,
  ADD COLUMN "configAppliedAt" TIMESTAMP(3);
