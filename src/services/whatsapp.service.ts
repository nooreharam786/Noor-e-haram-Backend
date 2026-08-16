import { PaymentStatus } from "@prisma/client";
import { env } from "../config/env";

type NotifyApplication = {
  registrationNo: string;
  phone: string;
  entryFee: number;
  paymentStatus?: PaymentStatus;
  user?: { name: string };
};

/**
 * Normalises an Indian phone number to the format required by WhatsApp API.
 * Returns empty string if the number cannot be normalised.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

async function sendWhatsAppText(phone: string, message: string): Promise<void> {
  const to = normalizePhone(phone);
  if (!to) return;

  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    // Development only — never log in production (phone numbers are PII)
    if (env.NODE_ENV !== "production") {
      console.info(`[whatsapp] (dev) Message queued for ${to.slice(0, 4)}***`);
    }
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: message },
      }),
    }
  );

  if (!response.ok) {
    // Log status code only — never log the message body (may contain PII)
    const status = response.status;
    console.error(`[whatsapp] Send failed — HTTP ${status}`);
    throw new Error(`WhatsApp send failed: HTTP ${status}`);
  }
}

/** Fire-and-forget wrapper — notification failures never propagate to the caller */
function safeNotify(task: Promise<void>): void {
  task.catch((err) => {
    console.error("[whatsapp] Notification failed:", err instanceof Error ? err.message : "unknown error");
  });
}

export function notifyApplicationSubmitted(application: NotifyApplication): void {
  safeNotify(
    sendWhatsAppText(
      application.phone,
      [
        `Assalamu Alaikum${application.user?.name ? ` ${application.user.name}` : ""}.`,
        `Your Noor-e-Haram application has been submitted successfully.`,
        `Registration No: ${application.registrationNo}`,
        `Entry Fee: Rs.${application.entryFee.toLocaleString("en-IN")}`,
        `Please complete payment to confirm your application.`,
      ].join("\n")
    )
  );
}

export function notifyPaymentVerified(application: NotifyApplication): void {
  if (application.paymentStatus !== PaymentStatus.paid) return;

  safeNotify(
    sendWhatsAppText(
      application.phone,
      [
        `Payment confirmed for Noor-e-Haram registration ${application.registrationNo}.`,
        `Your application has been included in the draw pool.`,
        `Please keep this Registration Number safe for result tracking.`,
      ].join("\n")
    )
  );
}

export function notifyDrawSelected(applications: NotifyApplication[]): void {
  for (const application of applications) {
    safeNotify(
      sendWhatsAppText(
        application.phone,
        [
          `MashaAllah! Your Noor-e-Haram registration ${application.registrationNo} has been selected.`,
          `Our team will contact you for verification and next steps.`,
        ].join("\n")
      )
    );
  }
}
