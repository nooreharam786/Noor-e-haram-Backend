import { Router } from "express";
import { adminRoutes } from "./admin.routes";
import { applicationRoutes } from "./application.routes";
import { authRoutes } from "./auth.routes";
import { contentRoutes } from "./content.routes";
import { paymentRoutes } from "./payment.routes";
import { validationRoutes } from "./validation.routes";
import { donationRoutes } from "./donation.routes";

export const apiRoutes = Router();

// ── Health / Readiness / Liveness probes (also accessible under /api) ────────
apiRoutes.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", service: "noor-e-haram-api", version: "1.0.0" },
  });
});

apiRoutes.get("/ready", async (_req, res) => {
  try {
    const { prisma } = await import("../config/prisma");
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: "ready", db: "connected" } });
  } catch {
    res.status(503).json({ success: false, data: { status: "not ready", db: "unreachable" } });
  }
});

apiRoutes.get("/live", (_req, res) => {
  res.json({ success: true, data: { status: "alive", ts: new Date().toISOString() } });
});

// ── Feature routes ─────────────────────────────────────────────────────────
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/applications", applicationRoutes);
apiRoutes.use("/content", contentRoutes);
apiRoutes.use("/payments", paymentRoutes);
apiRoutes.use("/validate", validationRoutes);
apiRoutes.use("/donations", donationRoutes);
apiRoutes.use("/admin", adminRoutes);
