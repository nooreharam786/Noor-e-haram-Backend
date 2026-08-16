import { z } from "zod";
import { PaymentStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../utils/http";
import { fetchRazorpayPayment } from "../../services/razorpay.service";
import { ensurePaymentReceipt } from "../../services/receipt.service";
import { generateReceiptPdf } from "../../services/pdf.service";
import { logAdminAction } from "../../services/audit.service";

// --- Schemas -----------------------------------------------------------------

export const listPaymentsSchema = z.object({
  query: z.object({
    page:          z.coerce.number().int().positive().default(1),
    limit:         z.coerce.number().int().positive().max(100).default(20),
    search:        z.string().trim().max(120).optional(),
    status:        z.nativeEnum(PaymentStatus).optional(),
    drawId:        z.string().optional(),
    dateFilter:    z.enum(["today", "week", "month"]).optional(),
    dateFrom:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
});

// --- Helpers -----------------------------------------------------------------

function buildDateFilter(dateFilter?: string, dateFrom?: string, dateTo?: string) {
  const now = new Date();
  if (dateFilter === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end   = new Date(now); end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }
  if (dateFilter === "week") {
    const start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
    return { gte: start };
  }
  if (dateFilter === "month") {
    const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
    return { gte: start };
  }
  if (dateFrom || dateTo) {
    return {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {})
    };
  }
  return undefined;
}

// --- Controllers -------------------------------------------------------------

export const listPayments = asyncHandler(async (req, res) => {
  const { page, limit, search, status, dateFilter, dateFrom, dateTo, drawId } = req.query as any;

  const dateRange = buildDateFilter(dateFilter, dateFrom, dateTo);

  const where: any = {
    ...(drawId ? { drawId } : {}),
    ...(status ? { paymentStatus: status } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
    ...(search ? {
      OR: [
        { registrationNo: { contains: search, mode: "insensitive" } },
        { paymentId:       { contains: search, mode: "insensitive" } },
        { orderId:         { contains: search, mode: "insensitive" } },
        { user: { OR: [
          { name:  { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } }
        ]}}
      ]
    } : {})
  };

  const [items, total] = await Promise.all([
    prisma.application.findMany({
      where,
      include: {
        user:    { select: { name: true, email: true } },
        draw:    { select: { id: true, name: true, drawIndex: true } },
        receipt: true
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take:  limit
    }),
    prisma.application.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) }
    }
  });
});

export const markPaymentSuccessful = asyncHandler(async (req, res) => {
  const { id } = req.params; // applicationId

  const application = await prisma.application.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } }, draw: { select: { name: true } } }
  });

  if (!application) {
    throw new HttpError(404, "Application not found");
  }

  // Idempotent: already paid
  if (application.paymentStatus === PaymentStatus.paid) {
    const receipt = await prisma.paymentReceipt.findUnique({ where: { applicationId: id } });
    return res.json({ success: true, message: "Already marked as paid", data: { application, receipt } });
  }

  if (!application.paymentId && !application.orderId) {
    throw new HttpError(400, "No Razorpay payment or order ID found. Cannot verify payment.");
  }

  // Verify payment actually exists on Razorpay before marking paid
  if (application.paymentId) {
    const rzpPayment = await fetchRazorpayPayment(application.paymentId);
    if ((rzpPayment as any).status !== "captured") {
      throw new HttpError(400, `Razorpay payment status is "${(rzpPayment as any).status}". Only captured payments can be marked successful.`);
    }
  }

  const oldStatus = application.paymentStatus;

  const updated = await prisma.application.update({
    where: { id },
    data: {
      paymentStatus: PaymentStatus.paid,
      completedAt:   new Date()
    }
  });

  // Generate receipt (idempotent)
  const receipt = await ensurePaymentReceipt(
    id,
    application.paymentId ?? "manual",
    application.orderId ?? "manual",
    application.entryFee
  );

  // Audit log with who, when, old?new status, IP
  await logAdminAction(
    req.user!.id,
    "MARK_PAYMENT_SUCCESSFUL",
    "Application",
    id,
    { registrationNo: application.registrationNo, receiptNo: receipt.receiptNo },
    req.ip ?? req.headers["x-forwarded-for"] as string,
    oldStatus,
    PaymentStatus.paid
  );

  res.json({ success: true, data: { application: updated, receipt } });
});

export const exportPaymentsCsv = asyncHandler(async (req, res) => {
  const { status, dateFilter, dateFrom, dateTo, search } = req.query as any;
  const dateRange = buildDateFilter(dateFilter, dateFrom, dateTo);

  const where: any = {
    ...(status ? { paymentStatus: status } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
    ...(search ? {
      OR: [
        { registrationNo: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } }
      ]
    } : {})
  };

  const items = await prisma.application.findMany({
    where,
    include: {
      user:    { select: { name: true, email: true } },
      draw:    { select: { name: true } },
      receipt: true
    },
    orderBy: { createdAt: "desc" },
    take: 10000
  });

  const header = ["Date","Name","Phone","Email","Amount","Order ID","Payment ID","Status","Draw","Receipt Number"];
  const rows = items.map((item) => [
    new Date(item.createdAt).toISOString().split("T")[0],
    item.user.name,
    item.phone,
    item.user.email,
    item.entryFee,
    item.orderId ?? "",
    item.paymentId ?? "",
    item.paymentStatus,
    item.draw.name,
    item.receipt?.receiptNo ?? ""
  ]);

  const csv = [header, ...rows].map((row) =>
    row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="payments-${Date.now()}.csv"`
  });
  res.send("\uFEFF" + csv); // UTF-8 BOM for Excel
});

export const downloadAdminReceipt = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      user:    { select: { name: true, email: true } },
      draw:    { select: { name: true } },
      receipt: true
    }
  });

  if (!application) throw new HttpError(404, "Application not found");
  if (application.paymentStatus !== PaymentStatus.paid) {
    throw new HttpError(400, "Receipt only available for paid applications");
  }
  if (!application.receipt) throw new HttpError(404, "Receipt not generated yet");

  const pdfBuffer = await generateReceiptPdf({
    ...application.receipt,
    application: {
      ...application,
      user: application.user,
      draw: application.draw
    }
  });

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="receipt-${application.receipt.receiptNo}.pdf"`,
    "Content-Length": pdfBuffer.length
  });

  res.send(pdfBuffer);
});
