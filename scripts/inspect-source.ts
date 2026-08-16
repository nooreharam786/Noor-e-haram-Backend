import { Client } from 'pg';

const SOURCE_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL || "";
const TARGET_URL = process.env.TARGET_DATABASE_URL || "";

async function main() {
  const source = new Client({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
  const target = new Client({ connectionString: TARGET_URL, ssl: { rejectUnauthorized: false } });

  await source.connect();
  await target.connect();

  console.log("Connected to both databases.");

  // Get all tables in public schema of source
  const tablesRes = await source.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const tables = tablesRes.rows.map(r => r.table_name);
  console.log(`Source contains ${tables.length} tables:`, tables);

  console.log("\nRow counts in SOURCE (pcszdataqkjwybefrzob):");
  for (const table of tables) {
    const countRes = await source.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
    console.log(` - ${table}: ${countRes.rows[0].count} rows`);
  }

  console.log("\nTarget (xqeajniniyqzotvypjvz) tables check:");
  const targetTablesRes = await target.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  const targetTables = targetTablesRes.rows.map(r => r.table_name);
  console.log(`Target contains ${targetTables.length} tables:`, targetTables);

  await source.end();
  await target.end();
}

main().catch(console.error);
