import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { loadEnv } from "../config";

const env = loadEnv();

const sqlite = new Database(env.ORDEM_DB_PATH);
export const db = drizzle(sqlite);

export function runMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  migrate(db, { migrationsFolder });
}
