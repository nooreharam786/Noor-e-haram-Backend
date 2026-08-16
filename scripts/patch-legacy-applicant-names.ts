import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log(`[Legacy Applicant Name Patch] Starting... (Mode: ${isDryRun ? "DRY RUN" : "EXECUTE"})`);

  try {
    // 1. Find applications with missing or empty applicantName
    const missingCount = await prisma.application.count({
      where: {
        OR: [
          { applicantName: "" }
        ]
      }
    });

    console.log(`Found ${missingCount} applications with missing/empty applicantName.`);

    if (isDryRun) {
      console.log(`[DRY RUN COMPLETE] Would patch ${missingCount} records. No database modifications performed.`);
      return;
    }

    if (missingCount === 0) {
      console.log("All application records already have valid applicantName fields. No patch needed.");
      return;
    }

    // 2. Perform non-destructive SQL update: set applicantName = user.name ONLY where applicantName is empty/NULL
    const result = await prisma.$executeRaw`
      UPDATE "Application"
      SET "applicantName" = "User"."name"
      FROM "User"
      WHERE "Application"."userId" = "User"."id"
        AND ("Application"."applicantName" IS NULL OR "Application"."applicantName" = '');
    `;

    console.log(`[PATCH COMPLETE] Patched: ${result} records. Already valid records preserved.`);
  } catch (error) {
    console.error("[PATCH ERROR] Failed to execute legacy applicant name patch:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
