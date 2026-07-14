import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(currentDir, '../..');

config({ path: resolve(serverDir, '.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing. Add it to server/.env before running db:apply.');
}

const sql = postgres(databaseUrl, { max: 1 });
const migrationPath = resolve(currentDir, 'migrations/0000_initial_spoilerfree.sql');

try {
  const migration = await readFile(migrationPath, 'utf8');
  console.log(`[db] applying ${migrationPath}`);
  await sql.unsafe(migration);
  console.log('[db] migration applied');
} finally {
  await sql.end();
}
