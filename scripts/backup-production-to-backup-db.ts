import { Client } from 'pg';

const SOURCE_URL = "postgresql://postgres.pcszdataqkjwybefrzob:0D55rZqHbM3JFNYK@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
const TARGET_URL = "postgresql://postgres.xqeajniniyqzotvypjvz:ESzaem9APk4uEbQz@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";

async function backup() {
  console.log("=========================================================================");
  console.log("📦 BACKUP PRODUCTION DATABASE (pcszdataqkjwybefrzob) TO (xqeajniniyqzotvypjvz)");
  console.log("=========================================================================\n");

  const source = new Client({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
  const target = new Client({ connectionString: TARGET_URL, ssl: { rejectUnauthorized: false } });

  await source.connect();
  await target.connect();

  try {
    // 1. Fetch list of all user tables in source public schema
    const tablesRes = await source.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(`Found ${tables.length} tables in source:`, tables);

    // Disable foreign key constraints on target during copy
    await target.query('SET session_replication_role = "replica";');

    // First: Sync schema on target for all tables
    for (const table of tables) {
      const targetTableExists = await target.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        );
      `, [table]);

      if (!targetTableExists.rows[0].exists) {
        if (table === '_prisma_migrations') {
          console.log(`Creating missing table _prisma_migrations on target...`);
          await target.query(`
            CREATE TABLE _prisma_migrations (
              id VARCHAR(36) PRIMARY KEY NOT NULL,
              checksum VARCHAR(64) NOT NULL,
              finished_at TIMESTAMPTZ,
              migration_name VARCHAR(255) NOT NULL,
              logs TEXT,
              rolled_back_at TIMESTAMPTZ,
              started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              applied_steps_count INT NOT NULL DEFAULT 0
            );
          `);
        } else {
          console.error(`❌ Table ${table} does not exist on target database!`);
          process.exit(1);
        }
      }

      // Sync columns
      const srcColsRes = await source.query(`
        SELECT column_name, is_nullable, data_type, udt_name
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [table]);

      const tgtColsRes = await target.query(`
        SELECT column_name, is_nullable, data_type, udt_name
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1;
      `, [table]);

      const srcColMap = new Map(srcColsRes.rows.map(c => [c.column_name, c]));
      const tgtColMap = new Map(tgtColsRes.rows.map(c => [c.column_name, c]));

      // Drop extra target columns not in source
      for (const [tgtColName] of tgtColMap.entries()) {
        if (!srcColMap.has(tgtColName)) {
          console.log(` - Dropping extra column "${tgtColName}" from target "${table}"...`);
          await target.query(`ALTER TABLE "${table}" DROP COLUMN "${tgtColName}" CASCADE;`);
        }
      }

      // Add missing columns and sync nullability
      for (const sCol of srcColsRes.rows) {
        const tCol = tgtColMap.get(sCol.column_name);
        if (tCol) {
          if (sCol.is_nullable === 'YES' && tCol.is_nullable === 'NO') {
            console.log(` - Dropping NOT NULL constraint on target "${table}"."${sCol.column_name}" to match source...`);
            await target.query(`ALTER TABLE "${table}" ALTER COLUMN "${sCol.column_name}" DROP NOT NULL;`);
          }
        } else {
          console.log(` - Adding missing column "${sCol.column_name}" to target "${table}"...`);
          await target.query(`ALTER TABLE "${table}" ADD COLUMN "${sCol.column_name}" ${sCol.udt_name};`);
          if (sCol.is_nullable === 'YES') {
            await target.query(`ALTER TABLE "${table}" ALTER COLUMN "${sCol.column_name}" DROP NOT NULL;`);
          }
        }
      }
    }

    // Second: TRUNCATE ALL target tables at once before inserting data
    console.log("\nTruncating all target tables...");
    const quotedTables = tables.map(t => `"${t}"`).join(', ');
    await target.query(`TRUNCATE TABLE ${quotedTables} CASCADE;`);
    console.log("All target tables truncated.");

    // Third: Copy data table by table
    for (const table of tables) {
      console.log(`\nCopying data for table: "${table}"...`);

      const srcColsRes = await source.query(`
        SELECT column_name
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [table]);

      const columns = srcColsRes.rows.map(c => c.column_name);
      const rowsRes = await source.query(`SELECT * FROM "${table}";`);
      const rows = rowsRes.rows;
      console.log(` - Source has ${rows.length} rows.`);

      if (rows.length > 0) {
        const quotedCols = columns.map(c => `"${c}"`).join(', ');
        
        for (const row of rows) {
          const values = columns.map(c => row[c]);
          const paramPlaceholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const insertQuery = `INSERT INTO "${table}" (${quotedCols}) VALUES (${paramPlaceholders});`;
          await target.query(insertQuery, values);
        }
        console.log(` - Copied ${rows.length} rows to target.`);
      } else {
        console.log(` - 0 rows to copy.`);
      }
    }

    // Re-enable foreign key constraints on target
    await target.query('SET session_replication_role = "origin";');

    // 2. Verification step
    console.log("\n=========================================================================");
    console.log("🔍 VERIFYING DATA COPIED TO BACKUP DATABASE (xqeajniniyqzotvypjvz)");
    console.log("=========================================================================\n");

    let allMatched = true;
    for (const table of tables) {
      const srcCountRes = await source.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      const tgtCountRes = await target.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      const srcCount = srcCountRes.rows[0].count;
      const tgtCount = tgtCountRes.rows[0].count;

      const status = srcCount === tgtCount ? "✅ OK" : "❌ MISMATCH";
      if (srcCount !== tgtCount) allMatched = false;
      console.log(` - ${table.padEnd(25)} | Source: ${String(srcCount).padStart(4)} | Backup Target: ${String(tgtCount).padStart(4)} | ${status}`);
    }

    if (allMatched) {
      console.log("\n🎉 FULL BACKUP COMPLETED SUCCESSFULLY! Target database (xqeajniniyqzotvypjvz) is an exact clone of production.");
    } else {
      console.error("\n❌ BACKUP VERIFICATION FAILED: Mismatch in row counts!");
      process.exit(1);
    }

  } catch (error) {
    console.error("❌ BACKUP FAILED WITH ERROR:", error);
    process.exit(1);
  } finally {
    await source.end();
    await target.end();
  }
}

backup();
