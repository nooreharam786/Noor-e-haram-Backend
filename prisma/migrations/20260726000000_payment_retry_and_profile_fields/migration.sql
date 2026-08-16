ALTER TABLE "Application"
  ADD COLUMN "lastPaymentAttemptAt" TIMESTAMP(3),
  ADD COLUMN "pincode" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Application_lastPaymentAttemptAt_idx" ON "Application"("lastPaymentAttemptAt");

ALTER TABLE "RegistrationCounter" ALTER COLUMN "counter" SET DEFAULT 100000;
