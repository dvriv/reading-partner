import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv, requireEnv } from '../env.js';
import * as schema from './schema.js';

let client: postgres.Sql | null = null;
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (database) return database;
  const env = getEnv();
  const url = requireEnv('databaseUrl', env.databaseUrl);
  client = postgres(url, { max: 10 });
  database = drizzle(client, { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  if (client) await client.end();
  client = null;
  database = null;
}
