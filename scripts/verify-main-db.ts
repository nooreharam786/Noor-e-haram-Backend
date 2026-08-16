import { Client } from 'pg';

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "",
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log("=================================================");
  console.log("🔍 POST-MIGRATION MAIN DATABASE VERIFICATION & BACKFILL");
  console.log("=================================================\n");

  // Run backfill query for PaymentAttempt from Application orderId
  const backfillRes = await client.query(`
    INSERT INTO "PaymentAttempt" (
      "id", "applicationId", "razorpayOrderId", "razorpayPaymentId", "status",
      "amount", "currency", "retryNumber", "gatewayStatus", "resolvedAt", "createdAt", "updatedAt"
    )
    SELECT
      'legacy_' || md5(application."orderId"),
      application."id",
      application."orderId",
      application."paymentId",
      CASE
        WHEN application."paymentStatus" = 'paid' THEN 'verified'::"PaymentAttemptStatus"
        WHEN application."paymentStatus" = 'failed' THEN 'failed'::"PaymentAttemptStatus"
        WHEN application."paymentStatus" = 'refunded' THEN 'verified'::"PaymentAttemptStatus"
        ELSE 'checkout_open'::"PaymentAttemptStatus"
      END,
      application."entryFee",
      'INR',
      0,
      'legacy',
      CASE WHEN application."paymentStatus" IN ('paid', 'failed', 'refunded') THEN COALESCE(application."completedAt", NOW()) ELSE NULL END,
      application."createdAt",
      application."updatedAt"
    FROM "Application" AS application
    WHERE application."orderId" IS NOT NULL
    ON CONFLICT ("razorpayOrderId") DO NOTHING;
  `);
  console.log(`PaymentAttempts backfilled: ${backfillRes.rowCount} rows inserted.`);

  const pa = await client.query(`SELECT COUNT(*)::int as count FROM "PaymentAttempt"`);
  console.log(`PaymentAttempts total count: ${pa.rows[0].count}`);

  const apps = await client.query(`SELECT id, "registrationNo", "applicantName", "paymentStatus", "orderId" FROM "Application" LIMIT 5`);
  console.log('\nApplications sample:');
  console.table(apps.rows);

  const draws = await client.query(`SELECT id, name, "maxApplicationsPerUser" FROM "Draw"`);
  console.log('\nDraws configuration:');
  console.table(draws.rows);

  const migrations = await client.query(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at ASC`);
  console.log('\nApplied Prisma Migrations:');
  console.table(migrations.rows);

  await client.end();
}

main().catch(console.error);
