import { analyticsQuery, getAnalyticsPool } from "./db.js";

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function aggregateDaily(
  workspaceId: string,
  startDate: Date,
  endDate: Date
) {
  const { eventSql, conversionSql } = getAggregateSql();
  await analyticsQuery(eventSql, [
    workspaceId,
    startDate.toISOString(),
    endDate.toISOString()
  ]);

  await analyticsQuery(conversionSql, [
    workspaceId,
    startDate.toISOString(),
    endDate.toISOString()
  ]);
}

export async function aggregateTodayAndYesterday(workspaceId: string) {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  await aggregateDaily(workspaceId, start, end);
}

export async function runAggregateWithLock(workspaceId: string) {
  const pool = getAnalyticsPool();
  const client = await pool.connect();
  const lockKey = 424242;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [lockKey]
    );
    if (!lock.rows[0]?.locked) return;
    await aggregateTodayAndYesterday(workspaceId);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    client.release();
  }
}

export { formatDate };

export function getAggregateSql() {
  const eventSql = `
    INSERT INTO event_daily_agg (date, workspace_id, event_name, count, unique_users_count)
    SELECT date_trunc('day', event_time)::date AS date,
           workspace_id,
           event_name,
           COUNT(*)::int AS count,
           COUNT(DISTINCT user_id)::int AS unique_users_count
    FROM events
    WHERE workspace_id = $1
      AND event_time >= $2
      AND event_time < $3
    GROUP BY date, workspace_id, event_name
    ON CONFLICT (date, workspace_id, event_name)
    DO UPDATE SET count = EXCLUDED.count,
                  unique_users_count = EXCLUDED.unique_users_count
  `;

  const conversionSql = `
    INSERT INTO conversion_daily_agg (date, workspace_id, conversion_name, count, value_cents_sum)
    SELECT date_trunc('day', occurred_at)::date AS date,
           workspace_id,
           conversion_name,
           COUNT(*)::int AS count,
           COALESCE(SUM(value_cents), 0)::int AS value_cents_sum
    FROM conversion_ledger
    WHERE workspace_id = $1
      AND occurred_at >= $2
      AND occurred_at < $3
    GROUP BY date, workspace_id, conversion_name
    ON CONFLICT (date, workspace_id, conversion_name)
    DO UPDATE SET count = EXCLUDED.count,
                  value_cents_sum = EXCLUDED.value_cents_sum
  `;

  return { eventSql, conversionSql };
}
