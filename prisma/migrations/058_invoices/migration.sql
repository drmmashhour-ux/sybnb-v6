-- SYBNB-generated invoices with per-division numbering (2026-10-10). SR-000045, STR-000123, etc.
CREATE TABLE "invoices" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "division" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "ride_id" TEXT,
  "booking_id" TEXT,
  "user_id" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "data" JSONB NOT NULL DEFAULT '{}',
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE UNIQUE INDEX "invoices_division_seq_key" ON "invoices"("division","seq");
CREATE INDEX "invoices_ride_id_idx" ON "invoices"("ride_id");
CREATE INDEX "invoices_booking_id_idx" ON "invoices"("booking_id");
CREATE INDEX "invoices_user_id_idx" ON "invoices"("user_id");

CREATE TABLE "invoice_counters" (
  "division" TEXT NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("division")
);
