import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { env } from "./config/env";
import { deleteFeedback } from "./controllers/admin.controller";
import { serveGalleryImage, servePublicDocument } from "./controllers/gallery.controller";
import { authenticate, requireAdmin } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/error";
import { apiRoutes } from "./routes";

// ── API routes ──────────────────────────────────────────────────────────────
export const app = express();


// ── Trust proxy (Vercel / Render / Nginx in front of Node) ─────────────────
app.set("trust proxy", 1);

// ── Security headers (Helmet) ───────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: false,
    contentSecurityPolicy: false,
    // Force HTTPS in production
    hsts:
      env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    // Disable X-Powered-By
    hidePoweredBy: true,
    // Nosniff MIME types
    noSniff: true,
    // XSS filter
    xssFilter: true,
  })
);

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (env.CORS_ORIGINS ?? `${env.FRONTEND_URL},${env.ADMIN_URL}`)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: env.NODE_ENV === "development" ? true : allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 86400, // 24 h preflight cache
  })
);

// ── Compression (gzip/brotli) ───────────────────────────────────────────────
app.use(
  compression({
    filter: (req, res) => {
      // Don't compress PDFs or binary streams already being served
      if (req.path.startsWith("/uploads/")) return false;
      return compression.filter(req, res);
    },
  })
);

// ── Request timeout middleware ──────────────────────────────────────────────
// Prevents connections from hanging forever
app.use((req, res, next) => {
  res.setTimeout(30_000, () => {
    res.status(503).json({ success: false, message: "Request timeout" });
  });
  next();
});

// ── Structured HTTP logging ─────────────────────────────────────────────────
// In production use "combined" (Apache format) — no body content is logged
// In development use "dev" for coloured concise output
if (env.NODE_ENV !== "test") {
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
}

// ── Webhook route MUST receive raw Buffer before any JSON parser ────────────
// Razorpay sends raw JSON body; signature is computed over raw bytes
app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "512kb" }));
app.use((req, _res, next) => {
  // Convert raw Buffer → string → parsed JSON for the webhook route only
  if (req.originalUrl.startsWith("/api/payments/webhook") && Buffer.isBuffer(req.body)) {
    (req as any).rawBody = req.body.toString("utf8");
    try {
      req.body = JSON.parse((req as any).rawBody);
    } catch {
      req.body = {};
    }
  }
  next();
});

// ── Body parsers ────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ── Global rate limiter ─────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: env.NODE_ENV === "production" ? 300 : 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many requests, please try again later." },
    skip: (req) =>
      req.path === "/api/health" || req.path === "/api/ready" || req.path === "/api/live",
  })
);

// ── Static file routes (before auth) ───────────────────────────────────────
app.get("/uploads/gallery/:id", serveGalleryImage);
app.get("/uploads/documents/:id", servePublicDocument);
app.get("/api/uploads/gallery/:id", serveGalleryImage);
app.get("/api/uploads/documents/:id", servePublicDocument);

// ── Health / Readiness / Liveness probes ───────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", service: "noor-e-haram-api", version: "1.0.0", env: env.NODE_ENV },
  });
});

app.get("/ready", async (_req, res) => {
  // DB ping check
  try {
    const { prisma } = await import("./config/prisma");
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: "ready", db: "connected" } });
  } catch {
    res.status(503).json({ success: false, data: { status: "not ready", db: "unreachable" } });
  }
});

app.get("/live", (_req, res) => {
  res.json({ success: true, data: { status: "alive", ts: new Date().toISOString() } });
});

// ── Root ────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ success: true, data: { message: "Noor-e-Haram Charity API", version: "1.0.0" } });
});

// ── Standalone admin feedback delete (legacy route kept for compatibility) ──
app.delete("/api/admin/feedback/:id", authenticate, requireAdmin, deleteFeedback);

// ── API routes ──────────────────────────────────────────────────────────────
app.use("/api", apiRoutes);

// ── Serve Admin SPA only in local development (path does not exist on Vercel) ──
// The admin panel is deployed as a separate Next.js app on Vercel.
// In production (Vercel), this block is intentionally skipped.
if (process.env.NODE_ENV !== "production" || process.env.VERCEL !== "1") {
  // Only attempt to serve static admin in local production builds
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
    const adminOutDir = path.resolve(__dirname, "../../admin/out");
    app.use("/admin", express.static(adminOutDir, { maxAge: "1d" }));
    app.get("/admin/*", (_req, res) => {
      res.sendFile(path.join(adminOutDir, "index.html"));
    });
  }
}

// ── 404 & Error handlers ────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;

