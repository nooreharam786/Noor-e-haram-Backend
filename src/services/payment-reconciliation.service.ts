import { PaymentAttemptStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { fetchRazorpayOrderPayments } from "./razorpay.service";

/**
 * Reconcile a currently unresolved order without trusting browser callbacks.
 *
 * We intentionally only transition an application to `failed` here. A paid
 * payment continues through the signature/webhook verification path, where
 * receipts and tickets are generated atomically. This avoids accepting an
 * unverified payment simply because a browser opened the dashboard.
 */
export async function reconcileUnresolvedPayment(applicationId: string, orderId: string | null) {
  if (!orderId) return false;

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { razorpayOrderId: orderId },
    select: { id: true, status: true },
  });

  // Old records can predate the ledger. They will be captured when a fresh
  // order is made, but there is nothing to reconcile until then.
  if (!attempt || attempt.status === PaymentAttemptStatus.verified) return false;

  let gateway;
  try {
    gateway = await fetchRazorpayOrderPayments(orderId);
  } catch {
    // Gateway lookups must never make the dashboard unavailable.
    return false;
  }

  const checkedAt = new Date();
  const sanitizedGatewayResponse = JSON.stringify({
    orderStatus: gateway.orderStatus,
    paymentCount: gateway.paymentStatuses.length,
    paymentStatuses: gateway.paymentStatuses,
  });
  const allAttemptsFailed = gateway.paymentStatuses.length > 0 && gateway.paymentStatuses.every((status) => status === "failed");

  await prisma.$transaction(async (tx) => {
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        gatewayStatus: allAttemptsFailed ? "failed" : gateway.orderStatus,
        gatewayCheckedAt: checkedAt,
        reconciliationAttempts: { increment: 1 },
        lastGatewayResponse: sanitizedGatewayResponse,
        ...(allAttemptsFailed && attempt.status !== PaymentAttemptStatus.failed
          ? { status: PaymentAttemptStatus.failed, failureReason: "Gateway reported all payment attempts failed", resolvedAt: checkedAt }
          : {}),
      },
    });

    if (allAttemptsFailed) {
      await tx.application.updateMany({
        where: { id: applicationId, paymentStatus: PaymentStatus.pending },
        data: { paymentStatus: PaymentStatus.failed, lastPaymentAttemptAt: checkedAt },
      });
      if (attempt.status !== PaymentAttemptStatus.failed) {
        await tx.paymentAuditEvent.create({
          data: {
            applicationId,
            paymentAttemptId: attempt.id,
            event: "GATEWAY_RECONCILED_FAILED",
            metadata: JSON.stringify({ paymentCount: gateway.paymentStatuses.length }),
          },
        });
      }
    }
  });

  return allAttemptsFailed;
}
