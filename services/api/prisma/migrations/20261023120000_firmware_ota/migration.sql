CREATE TABLE "FirmwareRelease" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "deviceId" TEXT NOT NULL,
 "version" TEXT NOT NULL,
 "buildNumber" INTEGER NOT NULL,
 "sha256" CHAR(64) NOT NULL,
 "sizeBytes" INTEGER NOT NULL,
 "fileName" TEXT NOT NULL,
 "notes" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FirmwareRelease_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LockerDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FirmwareRelease_deviceId_version_key" ON "FirmwareRelease"("deviceId", "version");
CREATE UNIQUE INDEX "FirmwareRelease_deviceId_buildNumber_key" ON "FirmwareRelease"("deviceId", "buildNumber");
CREATE INDEX "FirmwareRelease_deviceId_createdAt_idx" ON "FirmwareRelease"("deviceId", "createdAt");

CREATE TABLE "FirmwareUpdate" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "deviceId" TEXT NOT NULL,
 "releaseId" TEXT NOT NULL,
 "requestedBy" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "deliveredAt" TIMESTAMP(3),
 "result" TEXT,
 "resultReason" TEXT,
 "reportedFirmwareVersion" TEXT,
 "completedAt" TIMESTAMP(3),
 CONSTRAINT "FirmwareUpdate_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LockerDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "FirmwareUpdate_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "FirmwareRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FirmwareUpdate_deviceId_issuedAt_idx" ON "FirmwareUpdate"("deviceId", "issuedAt");
