import crypto from "crypto";
import Razorpay from "razorpay";
import { env } from "../config/env";
import { HttpError } from "../utils/http";

// Singleton razorpay client
const razorpay =
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
    ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET })
    : null;

export async function createRazorpayOrder(
  amount: number,
  receipt: string,
  notes: Record<string, string> = {}
) {
  if (!razorpay) {
    throw new HttpError(503, "Payment gateway is not configured on this server");
  }
  try {
    return await razorpay.orders.create({ amount: amount * 100, currency: "INR", receipt, notes });
  } catch (err: any) {
    console.error("[razorpay] createOrder failed:", err?.error?.description ?? "unknown");
    throw new HttpError(502, "Failed to create payment order. Please try again.");
  }
}

export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new HttpError(503, "Payment gateway is not configured on this server");
  }
  try {
    const generated = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    const a = Buffer.from(generated, "hex");
    const b = Buffer.from(signature.length === generated.length ? signature : "", "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    console.warn("[razorpay] RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook");
    return false;
  }
  try {
    const expected = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function fetchRazorpayPayment(paymentId: string) {
  if (!razorpay) throw new HttpError(503, "Payment gateway is not configured on this server");
  try {
    return await razorpay.payments.fetch(paymentId);
  } catch {
    throw new HttpError(404, "Payment not found on payment gateway");
  }
}

/**
 * Read the gateway state for one order.  Only the fields needed by the
 * reconciliation service are exposed; raw gateway payloads are deliberately
 * not persisted in our database.
 */
export async function fetchRazorpayOrderPayments(orderId: string) {
  if (!razorpay) throw new HttpError(503, "Payment gateway is not configured on this server");
  try {
    const [order, payments] = await Promise.all([
      razorpay.orders.fetch(orderId),
      razorpay.orders.fetchPayments(orderId),
    ]);
    return {
      orderStatus: order.status,
      paymentStatuses: payments.items.map((payment: { status: string }) => payment.status),
    };
  } catch {
    throw new HttpError(404, "Order not found on payment gateway");
  }
}
