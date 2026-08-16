import { app } from "./app";
import { env, maskSecret } from "./config/env";
import { disconnectPrisma } from "./config/prisma";

/**
 * Start the HTTP server ONLY when running locally (not on Vercel).
 *
 * On Vercel, the VERCEL environment variable is set to "1".
 * Calling app.listen() inside a Vercel serverless function would either:
 *   - throw an error (port binding not allowed in Lambda), or
 *   - cause the function to hang indefinitely.
 *
 * Vercel instead invokes the exported handler function directly.
 */
const isVercel = process.env.VERCEL === "1";

if (!isVercel) {
  const server = app.listen(env.PORT, () => {
    console.log("─────────────────────────────────────────────────────");
    console.log(`  Noor-e-Haram Charity API`);
    console.log(`  Env    : ${env.NODE_ENV}`);
    console.log(`  Port   : ${env.PORT}`);
    console.log(`  DB     : ${env.DATABASE_URL ? "configured" : "⚠️ NOT SET"}`);
    console.log(`  JWT    : ${maskSecret(env.JWT_SECRET)}`);
    console.log(`  RPay   : ${env.RAZORPAY_KEY_ID ?? "⚠️ not configured"}`);
    console.log("─────────────────────────────────────────────────────");
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Closes the HTTP server (stops accepting new connections) then disconnects
  // Prisma so all in-flight DB queries can finish before the process exits.

  async function shutdown(signal: string) {
    console.log(`\n[shutdown] Received ${signal}. Closing server...`);

    server.close(async () => {
      console.log("[shutdown] HTTP server closed.");

      try {
        await disconnectPrisma();
        console.log("[shutdown] Database disconnected. Exiting cleanly.");
      } catch (err) {
        console.error("[shutdown] Error disconnecting database:", err);
      }

      process.exit(0);
    });

    // Force-exit after 15 s if connections don't drain
    setTimeout(() => {
      console.error("[shutdown] Timeout exceeded. Forcing exit.");
      process.exit(1);
    }, 15_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Catch unhandled rejections and uncaught exceptions — log without leaking secrets
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error("[unhandledRejection]", msg);
  });

  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err.message);
    // Uncaught exceptions leave the process in an undefined state — exit
    process.exit(1);
  });
}

export default app;
