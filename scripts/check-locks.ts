import { Client } from 'pg';

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "",
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const locks = await client.query(`
    SELECT pid, locktype, objid, mode, granted 
    FROM pg_locks 
    WHERE locktype = 'advisory';
  `);
  console.log('Advisory locks:', locks.rows);

  const activity = await client.query(`
    SELECT pid, query, state, client_addr, application_name, backend_start 
    FROM pg_stat_activity 
    WHERE pid IN (SELECT pid FROM pg_locks WHERE locktype = 'advisory');
  `);
  console.log('Active lock holders:', activity.rows);

  // If there are pids holding advisory lock, terminate them
  for (const row of activity.rows) {
    console.log(`Terminating PID ${row.pid}...`);
    await client.query(`SELECT pg_terminate_backend($1);`, [row.pid]);
  }

  await client.end();
}

main().catch(console.error);
