CREATE TABLE "CustomerReservationAccess" (
  "reservationId" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "paymentIntentId" TEXT,
  "paidAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "requestKey" TEXT,
  "expectedAmount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'cad',
  "paymentState" TEXT NOT NULL DEFAULT 'UNPAID',
  "reconciliationReason" TEXT,
  "checkedAt" TIMESTAMP(3),
  CONSTRAINT "CustomerReservationAccess_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerReservationAccess_tokenHash_key" ON "CustomerReservationAccess"("tokenHash");
CREATE UNIQUE INDEX "CustomerReservationAccess_paymentIntentId_key" ON "CustomerReservationAccess"("paymentIntentId");
CREATE UNIQUE INDEX "CustomerReservationAccess_requestKey_key" ON "CustomerReservationAccess"("requestKey");
CREATE INDEX "CustomerReservationAccess_paymentState_idx" ON "CustomerReservationAccess"("paymentState");
ALTER TABLE "PaymentEvent" ADD COLUMN "reversedIntentId" TEXT, ADD COLUMN "outcome" TEXT, ADD COLUMN "reservationId" TEXT, ADD COLUMN "paymentIntentId" TEXT;
CREATE INDEX "PaymentEvent_reversedIntentId_idx" ON "PaymentEvent"("reversedIntentId");
