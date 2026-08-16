import { Router } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";

export const validationRoutes = Router();

// Universal ticket & receipt verification endpoint
validationRoutes.get("/ticket/:identifier", asyncHandler(async (req, res) => {
  const { identifier } = req.params;

  if (!identifier || identifier.trim() === "") {
    throw new HttpError(400, "Identifier is required for verification.");
  }

  const query = identifier.trim();

  // 1. Search Application table by registrationNo OR id
  const application = await prisma.application.findFirst({
    where: {
      OR: [
        { registrationNo: query },
        { id: query }
      ]
    },
    include: {
      user: { select: { name: true, email: true } },
      draw: { select: { name: true, status: true } }
    }
  });

  if (application) {
    const isPaid = application.paymentStatus === "paid";
    return res.json({
      success: true,
      data: {
        type: "ticket",
        id: application.id,
        registrationNo: application.registrationNo,
        drawName: application.draw?.name || "Official Lucky Draw",
        drawStatus: application.draw?.status || "active",
        applicantName: application.user?.name || "Applicant",
        email: application.user?.email,
        phone: application.phone,
        city: application.city,
        stateName: application.stateName,
        paymentStatus: application.paymentStatus,
        status: application.status,
        isPaid,
        appliedAt: application.createdAt,
        completedAt: application.completedAt,
        authenticityVerified: true,
      }
    });
  }

  // 2. Search Donation table by receiptId OR id
  const donation = await prisma.donation.findFirst({
    where: {
      OR: [
        { receiptId: query },
        { id: query },
        { paymentId: query }
      ]
    }
  });

  if (donation) {
    return res.json({
      success: true,
      data: {
        type: "donation_receipt",
        id: donation.id,
        receiptNo: donation.receiptId,
        donorName: donation.donorName,
        email: donation.email,
        phone: donation.phone,
        amount: donation.amount,
        donationType: donation.donationType,
        onBehalfOf: donation.onBehalfOf,
        paymentStatus: donation.status,
        isPaid: donation.status === "completed",
        appliedAt: donation.createdAt,
        authenticityVerified: true,
      }
    });
  }

  // 3. Not found in either
  throw new HttpError(404, "Invalid Ticket or Receipt. No matching official record was found.");
}));
