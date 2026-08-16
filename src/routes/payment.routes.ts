import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createOrder,
  markPaymentFailed,
  paymentFailedSchema,
  verifyPayment,
  verifyPaymentSchema,
  webhook,
  downloadReceipt,
} from "../controllers/payment.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const paymentRoutes = Router();

// Tighter rate limit for payment endpoints to prevent brute-force / replay attacks
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many payment requests. Please wait a few minutes." },
});

// Create a Razorpay order for the authenticated user's pending application
paymentRoutes.post("/create-order", authenticate, paymentLimiter, createOrder);

// Verify the payment after frontend checkout completes
paymentRoutes.post(
  "/verify",
  authenticate,
  paymentLimiter,
  validate(verifyPaymentSchema),
  verifyPayment
);

paymentRoutes.post("/failed", authenticate, paymentLimiter, validate(paymentFailedSchema), markPaymentFailed);

// Download payment receipt PDF (authenticated user can only download their own)
paymentRoutes.get("/:id/receipt", authenticate, downloadReceipt);

// Razorpay webhook — raw body is already attached in app.ts middleware
// express.raw() is NOT duplicated here; rawBody is available on req
paymentRoutes.post("/webhook", webhook);
