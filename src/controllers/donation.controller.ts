import { z } from "zod";
import { DonationStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { createRazorpayOrder, verifyRazorpaySignature } from "../services/razorpay.service";
import crypto from "crypto";

export const createDonationSchema = z.object({
  body: z.object({
    donorName: z.string().min(2),
    phone: z.string().min(7),
    email: z.string().email().optional().or(z.literal("")),
    amount: z.number().min(1),
    donationType: z.string().min(1),
    onBehalfOf: z.string().optional()
  })
});

function generateReceiptId() {
  return `DON-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export const createDonation = asyncHandler(async (req, res) => {
  const { donorName, phone, email, amount, donationType, onBehalfOf } = req.body;
  const userId = req.user?.id; // Optional, might be guest

  const receiptId = generateReceiptId();

  // Create donation record
  const donation = await prisma.donation.create({
    data: {
      receiptId,
      donorName,
      phone,
      email: email || null,
      amount,
      donationType,
      onBehalfOf: onBehalfOf || null,
      userId: userId || null,
      status: DonationStatus.pending
    }
  });

  // Create Razorpay order
  const order = await createRazorpayOrder(
    amount,
    donation.id,
    { donationId: donation.id, receiptId }
  );

  await prisma.donation.update({
    where: { id: donation.id },
    data: { orderId: order.id }
  });

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      donation
    }
  });
});

export const verifyDonationSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string().min(1),
    razorpay_payment_id: z.string().min(1),
    razorpay_signature: z.string().min(1)
  })
});

export const verifyDonation = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    throw new HttpError(400, "Invalid payment signature");
  }

  const donation = await prisma.donation.findFirst({
    where: { orderId: razorpay_order_id }
  });

  if (!donation) {
    throw new HttpError(404, "Donation not found");
  }

  const updated = await prisma.donation.update({
    where: { id: donation.id },
    data: { 
      status: DonationStatus.completed,
      paymentId: razorpay_payment_id
    }
  });

  res.json({ success: true, data: updated });
});

export const getMyDonations = asyncHandler(async (req, res) => {
  if (!req.user) throw new HttpError(401, "Unauthorized");

  const donations = await prisma.donation.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" }
  });

  res.json({ success: true, data: donations });
});
