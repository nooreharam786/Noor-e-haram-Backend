import { z } from "zod";
import { PaymentAttemptStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { asyncHandler, HttpError } from "../utils/http";
import { notifyPaymentVerified } from "../services/whatsapp.service";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from "../services/razorpay.service";
import { generateReceiptNo } from "../services/receipt.service";
import { generateReceiptPdf } from "../services/pdf.service";
import { logEvent } from "../utils/logger";
import { reconcileUnresolvedPayment } from "../services/payment-reconciliation.service";

// Entry fee is ALWAYS enforced server-side — never trust frontend
const ENTRY_FEE_INR = 1499;

// ── Create Order ─────────────────────────────────────────────────────────────

export const createOrder = asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const applicationId = typeof req.body?.applicationId === "string" ? req.body.applicationId : undefined;

  // A failed payment can be retried; a current pending order is safely reusable.
  let application = await prisma.application.findFirst({
    where: { userId, ...(applicationId ? { id: applicationId } : {}), paymentStatus: { in: [PaymentStatus.pending, PaymentStatus.failed] } },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, name: true } } },
  });

  if (!application) {
    throw new HttpError(404, "No unpaid application found. Please apply for the draw first.");
  }

  if (application.paymentStatus === PaymentStatus.pending) {
    await reconcileUnresolvedPayment(application.id, application.orderId);
    application = await prisma.application.findFirst({
      where: { id: application.id, userId },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!application || application.paymentStatus === PaymentStatus.paid) {
      throw new HttpError(409, "This application has already been paid.");
    }
  }

  // Reuse only a ledger-backed open attempt. Production records created before
  // PaymentAttempt existed have only Application.orderId; creating a fresh
  // order for those records preserves the old order as superseded and avoids
  // trapping an applicant on a stale checkout session.
  const currentAttempt = application.orderId
    ? await prisma.paymentAttempt.findUnique({
        where: { razorpayOrderId: application.orderId },
        select: { status: true },
      })
    : null;
  if (application.paymentStatus === PaymentStatus.pending && application.orderId && currentAttempt?.status === PaymentAttemptStatus.checkout_open) {
    return res.json({
      success: true,
      data: {
        orderId: application.orderId,
        amount: ENTRY_FEE_INR * 100, // paise
        currency: "INR",
        key: env.RAZORPAY_KEY_ID,
        user: {
          name: application.user.name,
          email: application.user.email,
          phone: application.phone,
        },
      },
    });
  }

  // Create a fresh Razorpay order
  const order = await createRazorpayOrder(ENTRY_FEE_INR, application.id, {
    userId: application.userId,
    registrationNo: application.registrationNo,
  });

  await prisma.$transaction(async (tx) => {
    // Preserve a legacy order before replacing Application.orderId. This is
    // what lets a delayed webhook for the old order still find its application.
    if (application.orderId) {
      await tx.paymentAttempt.upsert({
        where: { razorpayOrderId: application.orderId },
        create: { applicationId: application.id, razorpayOrderId: application.orderId, razorpayPaymentId: application.paymentId, amount: application.entryFee, status: PaymentAttemptStatus.superseded, supersededAt: new Date() },
        update: {},
      });
    }
    const retryNumber = await tx.paymentAttempt.count({ where: { applicationId: application.id } });
    await tx.paymentAttempt.create({ data: { applicationId: application.id, razorpayOrderId: order.id, amount: ENTRY_FEE_INR, retryNumber, status: PaymentAttemptStatus.checkout_open } });
    await tx.paymentAuditEvent.create({ data: { applicationId: application.id, event: "ATTEMPT_CREATED", metadata: JSON.stringify({ retryNumber }) } });
    await tx.application.update({
      where: { id: application.id },
      data: { orderId: order.id, entryFee: ENTRY_FEE_INR, paymentStatus: PaymentStatus.pending, lastPaymentAttemptAt: new Date() },
    });
  });

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount: order.amount,   // already in paise from Razorpay
      currency: order.currency,
      key: env.RAZORPAY_KEY_ID, // public key — safe to return
      user: {
        name: application.user.name,
        email: application.user.email,
        phone: application.phone,
      },
    },
  });
});

// ── Verify Payment ────────────────────────────────────────────────────────────

export const verifyPaymentSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string().min(1, "Order ID is required"),
    razorpay_payment_id: z.string().min(1, "Payment ID is required"),
    razorpay_signature: z.string().min(1, "Signature is required"),
  }),
});

export const paymentFailedSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string().min(1),
    reason: z.string().trim().max(200).optional(),
  }),
});

// Razorpay exposes checkout failures to the browser immediately. Recording a
// sanitized failure here gives the dashboard a useful state even if the
// asynchronous webhook is delayed or unavailable.
export const markPaymentFailed = asyncHandler(async (req, res) => {
  const { razorpay_order_id, reason } = req.body;
  const attempt = await prisma.paymentAttempt.findUnique({ where: { razorpayOrderId: razorpay_order_id } });
  const application = attempt
    ? await prisma.application.findUnique({ where: { id: attempt.applicationId } })
    : await prisma.application.findFirst({ where: { orderId: razorpay_order_id } });
  if (!application) throw new HttpError(404, "Application not found for this order");
  if (application.userId !== req.user!.id) throw new HttpError(403, "You are not authorised to update this payment");
  if (application.paymentStatus === PaymentStatus.paid) return res.json({ success: true, data: application });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.paymentAttempt.updateMany({
      where: { razorpayOrderId: razorpay_order_id },
      data: { status: PaymentAttemptStatus.failed, failureReason: reason || "Checkout failed or was cancelled", resolvedAt: new Date(), gatewayStatus: "failed" },
    });
    await tx.paymentAuditEvent.create({ data: { applicationId: application.id, paymentAttemptId: attempt?.id, event: "CHECKOUT_FAILED", metadata: reason ? JSON.stringify({ reason }) : undefined } });
    return tx.application.update({ where: { id: application.id }, data: { paymentStatus: PaymentStatus.failed } });
  });
  res.json({ success: true, data: updated });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // 1. Verify HMAC-SHA256 signature (timing-safe)
  const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    throw new HttpError(400, "Payment verification failed — invalid signature");
  }

  // 2. Find the application by orderId
  const attempt = await prisma.paymentAttempt.findUnique({ where: { razorpayOrderId: razorpay_order_id } });
  const application = attempt
    ? await prisma.application.findUnique({ where: { id: attempt.applicationId } })
    : await prisma.application.findFirst({ where: { orderId: razorpay_order_id } });

  if (!application) {
    throw new HttpError(404, "Application not found for this order");
  }

  // 3. Ownership check — only the user who created the order can verify it
  if (application.userId !== req.user!.id) {
    throw new HttpError(403, "You are not authorised to verify this payment");
  }

  // 4. Idempotency — already paid, return existing state without error
  if (application.paymentStatus === PaymentStatus.paid) {
    const existing = await prisma.application.findUnique({
      where: { id: application.id },
      include: { user: { select: { name: true } }, receipt: true },
    });
    return res.json({ success: true, data: existing });
  }

  // 5. Atomic transaction: update application + create receipt + audit log
  const result = await prisma.$transaction(async (tx) => {
    // Update application to paid
    const updatedApp = await tx.application.update({
      where: { id: application.id },
      data: {
        paymentStatus: PaymentStatus.paid,
        paymentId: razorpay_payment_id,
        completedAt: new Date(),
      },
      include: { user: { select: { name: true } } },
    });
    await tx.paymentAttempt.updateMany({ where: { razorpayOrderId: razorpay_order_id }, data: { razorpayPaymentId: razorpay_payment_id, status: PaymentAttemptStatus.verified, resolvedAt: new Date(), gatewayStatus: "captured" } });
    await tx.paymentAuditEvent.create({ data: { applicationId: application.id, paymentAttemptId: attempt?.id, event: "PAYMENT_VERIFIED", correlationId: razorpay_payment_id } });

    // Duplicate-safe receipt creation (applicationId is @unique in schema)
    let receipt = await tx.paymentReceipt.findUnique({
      where: { applicationId: application.id },
    });
    if (!receipt) {
      receipt = await tx.paymentReceipt.create({
        data: {
          receiptNo: generateReceiptNo(),
          applicationId: application.id,
          amount: ENTRY_FEE_INR,
          paymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
        },
      });
    }

    // Duplicate-safe audit log — idempotent by checking action + entityId + paymentId
    const existingLog = await tx.auditLog.findFirst({
      where: { action: "PAYMENT_VERIFIED", entityId: application.id },
    });
    if (!existingLog) {
      await tx.auditLog.create({
        data: {
          adminId: application.userId,
          action: "PAYMENT_VERIFIED",
          entity: "Application",
          entityId: application.id,
          details: `Payment verified via Razorpay. PaymentId: ${razorpay_payment_id}`,
          oldStatus: PaymentStatus.pending,
          newStatus: PaymentStatus.paid,
          ipAddress: req.ip,
        },
      });
    }

    return { ...updatedApp, receipt };
  });

  // 6. Fire-and-forget WhatsApp notification (never blocks response)
  notifyPaymentVerified(result);

  res.json({ success: true, data: result });
});

// ── Webhook ────────────────────────────────────────────────────────────────────
// rawBody is attached in app.ts BEFORE the JSON body parser

export const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"] as string;
  const rawBody = (req as any).rawBody as string;

  // Always return 200 to Razorpay to prevent retries on intentional rejections
  if (!signature || !rawBody) {
    return res.status(200).json({ success: false, message: "Missing signature or body" });
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhook] Signature mismatch — rejecting event");
    return res.status(200).json({ success: false, message: "Signature mismatch" });
  }

  const event = req.body?.event as string | undefined;
  const paymentEntity = req.body?.payload?.payment?.entity as Record<string, any> | undefined;

  // ── payment.captured ────────────────────────────────────────────────────
  if (event === "payment.captured" && paymentEntity) {
    const orderId = paymentEntity.order_id as string;
    const paymentId = paymentEntity.id as string;

    if (orderId && paymentId) {
      try {
        await prisma.$transaction(async (tx) => {
          // Only update if still pending (idempotent)
          const paymentAttempt = await tx.paymentAttempt.findUnique({ where: { razorpayOrderId: orderId } });
          const app = paymentAttempt
            ? await tx.application.findFirst({ where: { id: paymentAttempt.applicationId, paymentStatus: { not: PaymentStatus.paid } } })
            : await tx.application.findFirst({ where: { orderId, paymentStatus: { not: PaymentStatus.paid } } });

          if (!app) return; // already paid or not found

          await tx.application.update({
            where: { id: app.id },
            data: { paymentStatus: PaymentStatus.paid, paymentId, completedAt: new Date() },
          });
          await tx.paymentAttempt.updateMany({ where: { razorpayOrderId: orderId }, data: { razorpayPaymentId: paymentId, status: PaymentAttemptStatus.verified, resolvedAt: new Date(), gatewayStatus: "captured" } });
          await tx.paymentAuditEvent.create({ data: { applicationId: app.id, paymentAttemptId: paymentAttempt?.id, event: "WEBHOOK_CAPTURED", correlationId: paymentId } });

          // Duplicate-safe receipt
          const existingReceipt = await tx.paymentReceipt.findUnique({
            where: { applicationId: app.id },
          });
          if (!existingReceipt) {
            await tx.paymentReceipt.create({
              data: {
                receiptNo: generateReceiptNo(),
                applicationId: app.id,
                amount: app.entryFee,
                paymentId,
                orderId,
              },
            });
          }

          // Duplicate-safe audit log
          const existingLog = await tx.auditLog.findFirst({
            where: { action: "PAYMENT_CAPTURED_WEBHOOK", entityId: app.id },
          });
          if (!existingLog) {
            await tx.auditLog.create({
              data: {
                adminId: "WEBHOOK",
                action: "PAYMENT_CAPTURED_WEBHOOK",
                entity: "Application",
                entityId: app.id,
                details: `Captured via webhook. PaymentId: ${paymentId}`,
                oldStatus: app.paymentStatus,
                newStatus: PaymentStatus.paid,
                ipAddress: req.ip,
              },
            });
          }
        });
      } catch (err: any) {
        // Log but still return 200 to prevent Razorpay retries on transient DB errors
        console.error("[webhook] payment.captured processing error:", err?.message);
      }
    }
  }

  // ── payment.failed ──────────────────────────────────────────────────────
  if (event === "payment.failed" && paymentEntity) {
    const orderId = paymentEntity.order_id as string;
    const errorDesc = paymentEntity.error_description as string | undefined;

    if (orderId) {
      try {
        await prisma.$transaction(async (tx) => {
          const apps = await tx.application.findMany({
            where: { orderId, paymentStatus: PaymentStatus.pending },
          });

          if (apps.length === 0) return;

          await tx.application.updateMany({
            where: { orderId, paymentStatus: PaymentStatus.pending },
            data: { paymentStatus: PaymentStatus.failed },
          });

          for (const app of apps) {
            const existingLog = await tx.auditLog.findFirst({
              where: { action: "PAYMENT_FAILED_WEBHOOK", entityId: app.id },
            });
            if (!existingLog) {
              await tx.auditLog.create({
                data: {
                  adminId: "WEBHOOK",
                  action: "PAYMENT_FAILED_WEBHOOK",
                  entity: "Application",
                  entityId: app.id,
                  details: `Payment failed. Reason: ${errorDesc ?? "Unknown"}`,
                  oldStatus: PaymentStatus.pending,
                  newStatus: PaymentStatus.failed,
                  ipAddress: req.ip,
                },
              });
            }
          }
        });
      } catch (err: any) {
        console.error("[webhook] payment.failed processing error:", err?.message);
      }
    }
  }

  res.json({ success: true });
});

// ── Download Receipt ─────────────────────────────────────────────────────────

export const downloadReceipt = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const application = await prisma.application.findFirst({
    where: { id, userId: req.user!.id },
    include: {
      user: { select: { name: true, email: true } },
      draw: { select: { name: true } },
      receipt: true,
    },
  });

  if (!application) {
    throw new HttpError(404, "Application not found");
  }

  if (application.paymentStatus !== PaymentStatus.paid) {
    throw new HttpError(403, "Receipt is only available after successful payment");
  }

  if (!application.receipt) {
    throw new HttpError(404, "Receipt not generated yet. Please contact support.");
  }

  const pdfBuffer = await generateReceiptPdf({
    ...application.receipt,
    application: {
      ...application,
      user: application.user,
      draw: application.draw,
    },
  });

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="noor-e-haram-receipt-${application.receipt.receiptNo}.pdf"`,
    "Content-Length": pdfBuffer.length,
    "Cache-Control": "private, no-store",
  });

  res.send(pdfBuffer);
});
