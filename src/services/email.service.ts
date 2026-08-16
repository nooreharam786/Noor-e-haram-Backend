import nodemailer from "nodemailer";
import { env } from "../config/env";

function createTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  try {
    const transporter = createTransporter();

    if (!transporter) {
      if (env.NODE_ENV !== "production") {
        console.info(`[email] Password reset link for ${email}: ${resetUrl}`);
      } else {
        console.warn(`[email] SMTP not configured — password reset email could not be sent to ${email}`);
      }
      return;
    }

    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: "Reset your Noor-e-Haram account password",
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2926">
          <div style="background:#0B4633;padding:24px 32px;border-radius:12px 12px 0 0">
            <h1 style="color:#fff;margin:0;font-size:22px">Noor-e-Haram Charity Foundation</h1>
            <p style="color:#D8A820;margin:4px 0 0">Faith | Service | Humanity</p>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e8e0d0;border-top:none">
            <h2 style="color:#0B4633;margin-top:0">Reset your password</h2>
            <p>We received a request to reset the password for your account. Use the button below to choose a new password. This link expires in 30 minutes.</p>
            <div style="text-align:center;margin:32px 0">
              <a href="${resetUrl}"
                 style="background:#0B4633;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
                Reset Password
              </a>
            </div>
            <p style="color:#6b7280;font-size:13px">If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
          </div>
          <div style="background:#FAF9F4;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center">
            <p style="color:#9ca3af;font-size:12px;margin:0">This is an automated email from Noor-e-Haram Charity Foundation. Do not reply.</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error(`[email] SMTP email dispatch error (logged cleanly):`, err);
  }
}
