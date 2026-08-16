import { PaymentStatus, ApplicationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { notifyApplicationSubmitted } from "../services/whatsapp.service";
import { getActiveDraw } from "../services/draw-manager.service";
import { generateRegistrationNumber } from "../services/registration.service";
import { generateTicketPdf } from "../services/pdf.service";
import { reconcileUnresolvedPayment } from "../services/payment-reconciliation.service";

const entryFeeAmount = 1499;

export const indianStates = [
  { code: "AN", name: "Andaman and Nicobar Islands" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CH", name: "Chandigarh" },
  { code: "CT", name: "Chhattisgarh" },
  { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "HR", name: "Haryana" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "JK", name: "Jammu and Kashmir" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "LA", name: "Ladakh" },
  { code: "LD", name: "Lakshadweep" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "NL", name: "Nagaland" },
  { code: "OD", name: "Odisha" },
  { code: "PY", name: "Puducherry" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TG", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "UK", name: "Uttarakhand" },
  { code: "WB", name: "West Bengal" }
];

const stateCodes = new Set(indianStates.map((state) => state.code));

export const applySchema = z.object({
  body: z.object({
    phone: z.string().trim().min(7).max(20),
    // Optional for compatibility with the old client; new clients always send it.
    applicantName: z.string().trim().min(2).max(120).optional(),
    stateCode: z.string().trim().toUpperCase().refine((value) => stateCodes.has(value), "Select a valid state"),
    city: z.string().trim().min(2).max(80),
    address: z.string().trim().max(300).optional().default(""),
    // Existing applications and the current registration form may not have a
    // pincode. Accept blank/omitted values while validating one when supplied.
    pincode: z.union([z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"), z.literal("")]).optional().default(""),
    persons: z.number().int().min(1).optional(),
    travellers: z.array(z.object({
      fullName: z.string().trim().min(1),
      phone: z.string().trim().min(7).max(20)
    })).optional()
  })
});

export const apply = asyncHandler(async (req, res) => {
  const state = indianStates.find((item) => item.code === req.body.stateCode)!;
  
  const activeDraw = await getActiveDraw();

  if (!activeDraw) {
    throw new HttpError(400, "There is no active draw at the moment.");
  }

  if (activeDraw.appControlStatus && activeDraw.appControlStatus !== "open") {
    throw new HttpError(400, activeDraw.bannerMessage || "Applications are currently paused or closed for this draw.");
  }

  const applicantName = req.body.applicantName?.trim() || req.user!.email.split("@")[0];
  const application = await prisma.$transaction(async (tx) => {
    // Lock this account/draw pair so rapid double-clicks cannot bypass the
    // configured application cap.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${req.user!.id}:${activeDraw.id}`}))`;
    const currentCount = await tx.application.count({ where: { userId: req.user!.id, drawId: activeDraw.id } });
    const limit = activeDraw.maxApplicationsPerUser;
    if (limit !== 0 && currentCount >= limit) {
      const noun = limit === 1 ? "application" : "applications";
      throw new HttpError(409, `This draw allows ${limit} ${noun} per account. Open Dashboard to continue an existing payment.`);
    }

    const registrationNo = await generateRegistrationNumber(activeDraw.drawIndex || 0);
    return tx.application.create({
      data: {
        userId: req.user!.id,
        drawId: activeDraw.id,
        registrationNo,
        applicantName,
        phone: req.body.phone,
        stateCode: state.code,
        stateName: state.name,
        city: req.body.city,
        address: req.body.address ?? "",
        pincode: req.body.pincode ?? "",
        entryFee: entryFeeAmount
      },
      include: { user: { select: { name: true } } }
    });
  });

  notifyApplicationSubmitted(application);

  res.status(201).json({ success: true, data: application });
});

export const updateMyApplicationSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(7).max(20),
    address: z.string().trim().max(300),
    city: z.string().trim().min(2).max(80),
    stateCode: z.string().trim().toUpperCase().refine((value) => stateCodes.has(value), "Select a valid state"),
    pincode: z.union([z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"), z.literal("")]).optional().default("")
  })
});

export const updateMyApplication = asyncHandler(async (req, res) => {
  const application = await prisma.application.findFirst({
    where: { userId: req.user!.id, ...(req.params.id ? { id: req.params.id } : {}) },
    orderBy: { createdAt: "desc" }
  });
  if (!application) throw new HttpError(404, "Application not found");
  if (application.paymentStatus !== PaymentStatus.pending && application.paymentStatus !== PaymentStatus.failed) {
    throw new HttpError(409, "A paid application can no longer be edited");
  }

  const state = indianStates.find((item) => item.code === req.body.stateCode)!;
  const updated = await prisma.application.update({
    where: { id: application.id },
    data: { applicantName: req.body.fullName, phone: req.body.phone, address: req.body.address, city: req.body.city, stateCode: state.code, stateName: state.name, pincode: req.body.pincode }
  });
  const { logEvent } = await import("../utils/logger");
  logEvent("APPLICATION_UPDATE", { applicationId: updated.id, userId: req.user!.id, fields: ["applicantName", "phone", "address", "city", "stateCode", "pincode"] });
  res.json({ success: true, data: updated });
});

// Additive ID-based endpoint. /me remains available for older clients.
export const updateApplicationById = updateMyApplication;

export const myApplication = asyncHandler(async (req, res) => {
  let application = await prisma.application.findFirst({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    include: { draw: true, receipt: true }
  });

  if (application?.paymentStatus === PaymentStatus.pending) {
    await reconcileUnresolvedPayment(application.id, application.orderId);
    application = await prisma.application.findFirst({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      include: { draw: true, receipt: true },
    });
  }

  res.json({ success: true, data: application });
});

export const getMyDraws = asyncHandler(async (req, res) => {
  let applications = await prisma.application.findMany({
    where: { userId: req.user!.id },
    include: {
      draw: { select: { name: true, status: true, result: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  await Promise.all(
    applications
      .filter((application) => application.paymentStatus === PaymentStatus.pending)
      .map((application) => reconcileUnresolvedPayment(application.id, application.orderId))
  );
  applications = await prisma.application.findMany({
    where: { userId: req.user!.id },
    include: {
      draw: { select: { name: true, status: true, result: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json({ success: true, data: applications });
});

export const downloadTicket = asyncHandler(async (req, res) => {
  const application = await prisma.application.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: {
      user: { select: { name: true, email: true } },
      draw: { select: { name: true } }
    }
  });

  if (!application) {
    throw new HttpError(404, "Ticket not found");
  }

  if (application.paymentStatus !== PaymentStatus.paid) {
    throw new HttpError(403, "Cannot generate ticket for unpaid application");
  }

  const pdfBuffer = await generateTicketPdf(application);

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="noor-e-haram-ticket-${application.registrationNo}.pdf"`,
    "Content-Length": pdfBuffer.length
  });

  res.send(pdfBuffer);
});

export const states = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { states: indianStates, entryFee: entryFeeAmount } });
});

export const markPaid = asyncHandler(async (req, res) => {
  throw new HttpError(403, "Payment status can only be updated after gateway/admin verification");
});
