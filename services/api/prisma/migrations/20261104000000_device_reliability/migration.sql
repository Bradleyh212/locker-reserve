-- AlterTable
ALTER TABLE "DeviceCommand" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "expiryObservedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeviceHealth" (
    "deviceId" TEXT NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "bootId" TEXT,
    "uptimeMs" DOUBLE PRECISION,
    "resetReason" TEXT,
    "bootObservedAt" TIMESTAMP(3),
    "wifiDisconnects" INTEGER NOT NULL DEFAULT 0,
    "communicationFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceHealth_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commandId" TEXT,
    "uptimeMs" DOUBLE PRECISION,
    "resetReason" TEXT,
    "details" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEvent_dedupeKey_key" ON "DeviceEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "DeviceEvent_deviceId_timestamp_id_idx" ON "DeviceEvent"("deviceId", "timestamp", "id");

-- CreateIndex
CREATE INDEX "DeviceEvent_timestamp_idx" ON "DeviceEvent"("timestamp");

-- AddForeignKey
ALTER TABLE "DeviceHealth" ADD CONSTRAINT "DeviceHealth_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LockerDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LockerDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Include existing devices in silent-device detection immediately after migration.
INSERT INTO "DeviceHealth" ("deviceId", "offline", "wifiDisconnects", "communicationFailures", "updatedAt")
SELECT "id", false, 0, 0, CURRENT_TIMESTAMP FROM "LockerDevice";
