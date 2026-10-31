CREATE TABLE "LockerDevice" (
 "id" TEXT NOT NULL PRIMARY KEY, "lockerId" TEXT NOT NULL UNIQUE,
 "tokenHash" TEXT NOT NULL UNIQUE, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "lastSeen" TIMESTAMP(3), "doorState" TEXT NOT NULL DEFAULT 'UNKNOWN',
 "outputState" TEXT NOT NULL DEFAULT 'INACTIVE', "firmwareVersion" TEXT NOT NULL DEFAULT 'unknown',
 "actuationEnabled" BOOLEAN NOT NULL DEFAULT false, "maxPulseMs" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "LockerDevice_lockerId_fkey" FOREIGN KEY ("lockerId") REFERENCES "Locker"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "DeviceCommand" (
 "id" TEXT NOT NULL PRIMARY KEY, "deviceId" TEXT NOT NULL, "lockerId" TEXT NOT NULL,
 "requestedBy" TEXT NOT NULL, "reason" TEXT NOT NULL, "pulseMs" INTEGER NOT NULL,
 "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 "result" TEXT, "resultReason" TEXT, "completedAt" TIMESTAMP(3),
 CONSTRAINT "DeviceCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LockerDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DeviceCommand_deviceId_issuedAt_idx" ON "DeviceCommand"("deviceId", "issuedAt");
