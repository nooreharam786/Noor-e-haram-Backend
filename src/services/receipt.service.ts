import crypto from "crypto";
import { prisma } from "../config/prisma";

/**
 * Generate a unique receipt number.
 * Format: NHR-YYYYMMDD-XXXXXXXX (8 random hex chars)
 * Example: NHR-20260720-3F2A8B1C
 */
export function generateReceiptNo(): string {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  // 4 random bytes = 8 hex chars — collision probability ~1 in 4 billion per day
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `NHR-${datePart}-${rand}`;
}

/**
 * Idempotently create a PaymentReceipt for an application.
 * Returns the existing receipt if one already exists — never creates duplicates.
 * Uses a retry loop on the rare chance of a receipt number collision.
 */
export async function ensurePaymentReceipt(
  applicationId: string,
  paymentId: string,
  orderId: string,
  amount: number
) {
  // Fast path: receipt already exists
  const existing = await prisma.paymentReceipt.findUnique({ where: { applicationId } });
  if (existing) return existing;

  // Create with collision retry (up to 3 attempts)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.paymentReceipt.create({
        data: { receiptNo: generateReceiptNo(), applicationId, amount, paymentId, orderId },
      });
    } catch (err: any) {
      // P2002 = Unique constraint violation (receiptNo collision)
      if (err?.code === "P2002" && err?.meta?.target?.includes("receiptNo") && attempt < 2) {
        continue; // retry with a new random receipt number
      }
      // P2002 on applicationId means another request created it concurrently
      if (err?.code === "P2002" && err?.meta?.target?.includes("applicationId")) {
        const created = await prisma.paymentReceipt.findUnique({ where: { applicationId } });
        if (created) return created;
      }
      throw err;
    }
  }

  throw new Error(`Failed to generate unique receipt number after 3 attempts for application ${applicationId}`);
}
