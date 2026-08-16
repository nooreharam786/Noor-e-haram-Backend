import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

// Load .env from process.cwd() or fallback directories if running from subfolder/root
dotenv.config();
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });
}
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),

  // Database — required
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // JWT — required in production, must be long enough to be safe
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters").optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Frontend & Admin URLs
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  ADMIN_URL: z.string().url().default("http://localhost:3000"),
  API_PUBLIC_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().optional(),

  // Cookie secret (for signed cookies if used)
  COOKIE_SECRET: z.string().min(32).optional(),

  // OAuth — optional
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),

  // SMTP — optional (graceful fallback to console.info if missing)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Noor-e-Haram <no-reply@nooreharam.com>"),

  // WhatsApp Cloud API — optional
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v20.0"),

  // Razorpay — required in production
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Cloudinary — optional (for future media uploads)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Supabase Storage — required for PDF document storage
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(32).optional(),
});

// Parse early so startup fails fast on misconfiguration
const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error("❌ Invalid environment configuration:");
  const errors = _parsed.error.flatten().fieldErrors;
  for (const [key, msgs] of Object.entries(errors)) {
    console.error(`  ${key}: ${(msgs ?? []).join(", ")}`);
  }
  process.exit(1);
}

export const env = _parsed.data;

// Warn in production when optional-but-important secrets are missing
if (env.NODE_ENV === "production") {
  const warnings: string[] = [];

  if (!env.RAZORPAY_KEY_ID)       warnings.push("RAZORPAY_KEY_ID");
  if (!env.RAZORPAY_KEY_SECRET)   warnings.push("RAZORPAY_KEY_SECRET");
  if (!env.RAZORPAY_WEBHOOK_SECRET) warnings.push("RAZORPAY_WEBHOOK_SECRET");
  if (!env.SMTP_HOST)              warnings.push("SMTP_HOST (email delivery disabled)");
  if (!env.COOKIE_SECRET)         warnings.push("COOKIE_SECRET");
  if (!env.SUPABASE_URL)           warnings.push("SUPABASE_URL (document storage disabled)");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) warnings.push("SUPABASE_SERVICE_ROLE_KEY (document storage disabled)");

  if (warnings.length > 0) {
    console.warn("⚠️  Production warnings — the following env vars are not set:");
    warnings.forEach((w) => console.warn(`   • ${w}`));
  }
}

/** Returns a masked version of a secret for safe logging (never log raw secrets). */
export function maskSecret(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}
