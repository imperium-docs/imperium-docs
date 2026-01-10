import { Pool, type PoolClient } from "pg";
import { loadEnv } from "../config.js";

let pool: Pool | null = null;

export function getAnalyticsPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.ANALYTICS_DATABASE_URL,
      max: env.ANALYTICS_POOL_MAX
    });
  }
  return pool;
}

export async function analyticsQuery<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await getAnalyticsPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function analyticsTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getAnalyticsPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
