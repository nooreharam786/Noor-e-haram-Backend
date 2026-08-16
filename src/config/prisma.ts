import { PrismaClient } from "@prisma/client";

const logLevel: ("query" | "error" | "warn")[] =
  process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"];

/**
 * Prisma Singleton for Vercel Serverless Compatibility
 *
 * On Vercel, each cold start imports this module fresh. Without caching on
 * the global object, a new PrismaClient is instantiated on every invocation,
 * quickly exhausting the database connection pool.
 *
 * We cache the instance on `globalThis` so warm invocations reuse the
 * existing connected client. In local development `global.prisma` is
 * undefined on each restart, so a fresh instance is always created.
 *
 * See: https://www.prisma.io/docs/guides/performance-and-optimization/connection-management#prismaclient-in-serverless-environments
 */
declare global {
  // eslint-disable-next-line no-var
  var _prismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis._prismaClient ??
  new PrismaClient({
    log: logLevel,
    errorFormat: "minimal",
  });

// Cache in every environment. Local servers may intentionally use
// NODE_ENV=production while pointing at staging; without this, TS hot reloads
// open a new pooled connection for every module reload and exhaust Supabase.
globalThis._prismaClient = prisma;

// Graceful disconnect hook — called by server.ts shutdown handler (local only)
export async function disconnectPrisma() {
  await prisma.$disconnect();
}
