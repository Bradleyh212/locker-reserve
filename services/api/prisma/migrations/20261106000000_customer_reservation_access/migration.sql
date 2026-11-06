CREATE TABLE "CustomerReservationAccess" (
  "reservationId" TEXT PRIMARY KEY REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL,
  "paymentIntentId" TEXT,
  "paidAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CHECK ("paidAt" IS NULL OR "paymentIntentId" IS NOT NULL)
);
CREATE UNIQUE INDEX "CustomerReservationAccess_tokenHash_key" ON "CustomerReservationAccess"("tokenHash");
CREATE UNIQUE INDEX "CustomerReservationAccess_paymentIntentId_key" ON "CustomerReservationAccess"("paymentIntentId");
ALTER TABLE "DeviceCommand"
  ADD COLUMN "reservationId" TEXT REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "requestKey" TEXT,
  ADD CONSTRAINT "DeviceCommand_customer_key_pair" CHECK (("reservationId" IS NULL) = ("requestKey" IS NULL));
CREATE UNIQUE INDEX "DeviceCommand_reservationId_requestKey_key" ON "DeviceCommand"("reservationId", "requestKey");
ALTER TABLE "PaymentEvent" ADD COLUMN "reversedIntentId" TEXT;
CREATE INDEX "PaymentEvent_reversedIntentId_idx" ON "PaymentEvent"("reversedIntentId");
