require("dotenv").config();
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "pincode" TEXT NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Application_lastPaymentAttemptAt_idx" ON "Application"("lastPaymentAttemptAt")`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "RegistrationCounter" ALTER COLUMN "counter" SET DEFAULT 100000`);
  console.info("The remaining schema changes were applied safely.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
