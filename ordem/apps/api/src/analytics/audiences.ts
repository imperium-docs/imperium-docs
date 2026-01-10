type SqlFragment = { text: string; values: unknown[] };

type AudienceRule =
  | { and: AudienceRule[] }
  | { or: AudienceRule[] }
  | { not: AudienceRule }
  | { event: { name: string; count_gte?: number; within_days?: number } }
  | { conversion: { name: string; within_days?: number } }
  | { user: { created_within_days?: number } }
  | { attr: { utm_source_in?: string[]; utm_campaign_in?: string[] } }
  | { consent: { purpose_required: string[] } };

function shiftParams(text: string, offset: number) {
  return text.replace(/\$(\d+)/g, (_, num) =>
    `$${Number(num) + offset}`.toString()
  );
}

function combineSql(op: "INTERSECT" | "UNION" | "EXCEPT", parts: SqlFragment[]) {
  const values: unknown[] = [];
  const text = parts
    .map((part) => {
      const shifted = shiftParams(part.text, values.length);
      values.push(...part.values);
      return `(${shifted})`;
    })
    .join(` ${op} `);
  return { text, values };
}

function baseUsersSql(workspaceId: string): SqlFragment {
  return {
    text: `
      SELECT user_id
      FROM (
        SELECT user_id FROM workspace_members WHERE workspace_id = $1
        UNION
        SELECT user_id FROM events WHERE workspace_id = $1 AND user_id IS NOT NULL
        UNION
        SELECT user_id FROM consents WHERE workspace_id = $1
        UNION
        SELECT user_id FROM conversion_ledger WHERE workspace_id = $1 AND user_id IS NOT NULL
      ) AS workspace_users
    `,
    values: [workspaceId]
  };
}

function leafSql(rule: AudienceRule, workspaceId: string): SqlFragment {
  if ("event" in rule) {
    const { name, count_gte = 1, within_days } = rule.event;
    const values: unknown[] = [workspaceId, name, count_gte];
    let filter = "event_time >= NOW() - ($4::text || ' days')::interval";
    if (!within_days) {
      filter = "event_time IS NOT NULL";
      values.pop();
    } else {
      values.push(within_days);
    }
    return {
      text: `
        SELECT user_id
        FROM events
        WHERE workspace_id = $1
          AND event_name = $2
          AND user_id IS NOT NULL
          AND ${filter}
        GROUP BY user_id
        HAVING COUNT(*) >= $3
      `,
      values
    };
  }

  if ("conversion" in rule) {
    const { name, within_days } = rule.conversion;
    const values: unknown[] = [workspaceId, name];
    let filter = "occurred_at >= NOW() - ($3::text || ' days')::interval";
    if (!within_days) {
      filter = "occurred_at IS NOT NULL";
    } else {
      values.push(within_days);
    }
    return {
      text: `
        SELECT user_id
        FROM conversion_ledger
        WHERE workspace_id = $1
          AND conversion_name = $2
          AND user_id IS NOT NULL
          AND ${filter}
        GROUP BY user_id
      `,
      values
    };
  }

  if ("user" in rule) {
    const { created_within_days } = rule.user;
    const base = baseUsersSql(workspaceId);
    if (!created_within_days) {
      return base;
    }
    const baseText = shiftParams(base.text, 1);
    return {
      text: `
        SELECT u.id AS user_id
        FROM users u
        WHERE u.created_at >= NOW() - ($1::text || ' days')::interval
          AND u.id IN (${baseText})
      `,
      values: [created_within_days, ...base.values]
    };
  }

  if ("attr" in rule) {
    const values: unknown[] = [workspaceId];
    const filters: string[] = [];
    if (rule.attr.utm_source_in?.length) {
      values.push(rule.attr.utm_source_in);
      filters.push(`(last_touch->>'utm_source') = ANY($${values.length})`);
    }
    if (rule.attr.utm_campaign_in?.length) {
      values.push(rule.attr.utm_campaign_in);
      filters.push(`(last_touch->>'utm_campaign') = ANY($${values.length})`);
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
    return {
      text: `
        SELECT user_id
        FROM attribution
        WHERE workspace_id = $1
          ${where}
      `,
      values
    };
  }

  if ("consent" in rule) {
    const values: unknown[] = [workspaceId, JSON.stringify(rule.consent.purpose_required)];
    return {
      text: `
        SELECT c.user_id
        FROM (
          SELECT DISTINCT ON (user_id) user_id, granted, purposes
          FROM consents
          WHERE workspace_id = $1
          ORDER BY user_id, created_at DESC
        ) c
        WHERE c.granted = true
          AND c.purposes @> $2::jsonb
      `,
      values
    };
  }

  return { text: "SELECT id AS user_id FROM users", values: [] };
}

export function buildAudienceSql(
  rule: AudienceRule,
  workspaceId: string
): SqlFragment {
  if ("and" in rule) {
    const parts = rule.and.map((item) => buildAudienceSql(item, workspaceId));
    return combineSql("INTERSECT", parts);
  }
  if ("or" in rule) {
    const parts = rule.or.map((item) => buildAudienceSql(item, workspaceId));
    return combineSql("UNION", parts);
  }
  if ("not" in rule) {
    const base = baseUsersSql(workspaceId);
    const negative = buildAudienceSql(rule.not, workspaceId);
    return combineSql("EXCEPT", [base, negative]);
  }
  return leafSql(rule, workspaceId);
}

export function offsetSql(sql: SqlFragment, offset: number): SqlFragment {
  return {
    text: shiftParams(sql.text, offset),
    values: sql.values
  };
}

export type { AudienceRule, SqlFragment };
