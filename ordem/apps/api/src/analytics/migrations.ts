import fs from "node:fs";
import path from "node:path";
import { getAnalyticsPool } from "./db.js";

type MigrationRow = { id: string };

const MIGRATIONS_TABLE = "analytics_schema_migrations";

export async function runAnalyticsMigrations() {
  const pool = getAnalyticsPool();
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id text PRIMARY KEY, run_at timestamptz NOT NULL DEFAULT now())`
    );
    const applied = await client.query<MigrationRow>(
      `SELECT id FROM ${MIGRATIONS_TABLE}`
    );
    const appliedSet = new Set(
      applied.rows.map((row: MigrationRow) => row.id)
    );
    const migrationsDir = path.resolve(process.cwd(), "analytics-migrations");
    if (!fs.existsSync(migrationsDir)) return;
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1)`,
        [file]
      );
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
