CREATE TYPE "PaymentAttemptStatus" AS ENUM ('created', 'checkout_open', 'failed', 'cancelled', 'expired', 'superseded', 'verified');
CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "razorpayOrderId" TEXT NOT NULL, "razorpayPaymentId" TEXT,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'created', "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'INR', "retryNumber" INTEGER NOT NULL DEFAULT 0,
  "gatewayStatus" TEXT, "gatewayCheckedAt" TIMESTAMP(3), "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0, "lastGatewayResponse" TEXT,
  "failureReason" TEXT, "resolvedAt" TIMESTAMP(3), "supersededAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentAttempt_razorpayOrderId_key" ON "PaymentAttempt"("razorpayOrderId");
CREATE UNIQUE INDEX "PaymentAttempt_razorpayPaymentId_key" ON "PaymentAttempt"("razorpayPaymentId");
CREATE INDEX "PaymentAttempt_applicationId_createdAt_idx" ON "PaymentAttempt"("applicationId", "createdAt");
CREATE INDEX "PaymentAttempt_applicationId_status_idx" ON "PaymentAttempt"("applicationId", "status");
CREATE INDEX "PaymentAttempt_status_gatewayCheckedAt_idx" ON "PaymentAttempt"("status", "gatewayCheckedAt");
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "PaymentAuditEvent" ("id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "paymentAttemptId" TEXT, "event" TEXT NOT NULL, "correlationId" TEXT, "metadata" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PaymentAuditEvent_pkey" PRIMARY KEY ("id"));
CREATE INDEX "PaymentAuditEvent_applicationId_createdAt_idx" ON "PaymentAuditEvent"("applicationId", "createdAt");
CREATE INDEX "PaymentAuditEvent_paymentAttemptId_createdAt_idx" ON "PaymentAuditEvent"("paymentAttemptId", "createdAt");
CREATE INDEX "PaymentAuditEvent_correlationId_idx" ON "PaymentAuditEvent"("correlationId");

-- Preserve every pre-ledger Razorpay order so an older failed/pending
-- application can still be reconciled or resumed after this migration.
-- The deterministic legacy id makes this idempotent with the unique order id.
INSERT INTO "PaymentAttempt" (
  "id", "applicationId", "razorpayOrderId", "razorpayPaymentId", "status",
  "amount", "currency", "retryNumber", "gatewayStatus", "resolvedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy_' || md5(application."orderId"),
  application."id",
  application."orderId",
  application."paymentId",
  CASE
    WHEN application."paymentStatus" = 'paid' THEN 'verified'::"PaymentAttemptStatus"
    WHEN application."paymentStatus" = 'failed' THEN 'failed'::"PaymentAttemptStatus"
    WHEN application."paymentStatus" = 'refunded' THEN 'verified'::"PaymentAttemptStatus"
    ELSE 'checkout_open'::"PaymentAttemptStatus"
  END,
  application."entryFee",
  'INR',
  0,
  'legacy',
  CASE WHEN application."paymentStatus" IN ('paid', 'failed', 'refunded') THEN COALESCE(application."completedAt", NOW()) ELSE NULL END,
  application."createdAt",
  application."updatedAt"
FROM "Application" AS application
WHERE application."orderId" IS NOT NULL
ON CONFLICT ("razorpayOrderId") DO NOTHING;
