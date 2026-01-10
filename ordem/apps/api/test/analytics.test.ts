import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getAggregateSql } from "../src/analytics/aggregates.js";

test("dedupe constraints are defined in analytics migrations", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "analytics-migrations",
    "001_init.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.ok(sql.includes("UNIQUE (workspace_id, event_id)"));
  assert.ok(sql.includes("UNIQUE (workspace_id, conversion_name, dedupe_key)"));
});

test("aggregate queries upsert daily aggregates", () => {
  const { eventSql, conversionSql } = getAggregateSql();
  assert.ok(eventSql.includes("INSERT INTO event_daily_agg"));
  assert.ok(eventSql.includes("ON CONFLICT (date, workspace_id, event_name)"));
  assert.ok(conversionSql.includes("INSERT INTO conversion_daily_agg"));
  assert.ok(
    conversionSql.includes("ON CONFLICT (date, workspace_id, conversion_name)")
  );
});
