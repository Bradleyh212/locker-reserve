CREATE TABLE "DeviceCommandReconciliation" (
  "commandId" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "physicalSafetyConfirmed" BOOLEAN NOT NULL,
  "originalResult" TEXT,
  "originalResultReason" TEXT,
  "originalCompletedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceCommandReconciliation_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "DeviceCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeviceCommandReconciliation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "LockerDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeviceCommandReconciliation_physical_review_check" CHECK ("physicalSafetyConfirmed" = true)
);
CREATE INDEX "DeviceCommandReconciliation_deviceId_acknowledgedAt_idx" ON "DeviceCommandReconciliation"("deviceId", "acknowledgedAt");
