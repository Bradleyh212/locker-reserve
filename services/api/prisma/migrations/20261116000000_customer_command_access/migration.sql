-- Reuse main's existing CustomerReservationAccess and payment fields unchanged.
ALTER TABLE "DeviceCommand"
  ADD COLUMN "reservationId" TEXT REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "requestKey" TEXT,
  ADD CONSTRAINT "DeviceCommand_customer_key_pair" CHECK (("reservationId" IS NULL) = ("requestKey" IS NULL));
CREATE UNIQUE INDEX "DeviceCommand_reservationId_requestKey_key" ON "DeviceCommand"("reservationId", "requestKey");
