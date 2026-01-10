import crypto from "node:crypto";
import argon2 from "argon2";
import { analyticsQuery, getAnalyticsPool } from "./db.js";
import { eventCatalog } from "./catalog.js";
import { normalizeEmail } from "./utils.js";
import { buildAudienceSql, offsetSql, type AudienceRule } from "./audiences.js";
import { aggregateDaily } from "./aggregates.js";

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Fabio",
  "Gabi",
  "Hugo",
  "Isabel",
  "Joao",
  "Karina",
  "Luca",
  "Marina",
  "Nina",
  "Otavio",
  "Paula",
  "Rafa",
  "Sara",
  "Tiago",
  "Vera"
];

const LAST_NAMES = [
  "Silva",
  "Souza",
  "Costa",
  "Oliveira",
  "Pereira",
  "Almeida",
  "Gomes",
  "Ribeiro",
  "Carvalho",
  "Ferreira"
];

const UTM_SOURCES = ["telegram", "instagram", "youtube", "direct", "referral"];
const UTM_CAMPAIGNS = ["imperium-launch", "academy-spring", "atlas-boost", "ordem-core"];

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(list: T[]) => list[random(0, list.length - 1)];

const randomDateInLastDays = (days: number) => {
  const now = Date.now();
  const offset = random(0, days * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
};

export async function seedAnalytics() {
  const pool = getAnalyticsPool();
  const client = await pool.connect();
  const forceSeed = process.env.ANALYTICS_SEED_FORCE === "true";
  try {
    await client.query("BEGIN");

    const workspaceResult = await client.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ["Imperium"]
    );
    const workspaceId = workspaceResult.rows[0].id;

    const consentVersion = await client.query<{ id: string }>(
      `INSERT INTO consent_versions (version, content_markdown, content_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO UPDATE SET content_markdown = EXCLUDED.content_markdown
       RETURNING id`,
      [
        "2026-01-07",
        "Consentimento Imperium 2026-01-07.",
        crypto.createHash("sha256").update("imperium-consent").digest("hex")
      ]
    );
    const consentVersionId = consentVersion.rows[0].id;

    const adminPassword = await argon2.hash("imperium-admin-please-change");
    const analystPassword = await argon2.hash(
      "imperium-analyst-please-change"
    );

    const adminUser = await client.query<{ id: string }>(
      `INSERT INTO users (email, email_normalized, name, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (email_normalized) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ["admin@imperium.local", normalizeEmail("admin@imperium.local"), "Admin"]
    );
    const adminUserId = adminUser.rows[0].id;

    const analystUser = await client.query<{ id: string }>(
      `INSERT INTO users (email, email_normalized, name, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (email_normalized) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        "analyst@imperium.local",
        normalizeEmail("analyst@imperium.local"),
        "Analyst"
      ]
    );
    const analystUserId = analystUser.rows[0].id;

    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [adminUserId, adminPassword]
    );
    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [analystUserId, analystPassword]
    );

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, adminUserId]
    );
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'analyst')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, analystUserId]
    );

    for (const entry of eventCatalog) {
      await client.query(
        `INSERT INTO event_catalog
         (name, owner_area, description, pii_level, required_purposes, schema_version, schema_json, sample_event_json)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb)
         ON CONFLICT (name)
         DO UPDATE SET description = EXCLUDED.description,
                       pii_level = EXCLUDED.pii_level,
                       required_purposes = EXCLUDED.required_purposes,
                       schema_version = EXCLUDED.schema_version,
                       schema_json = EXCLUDED.schema_json,
                       sample_event_json = EXCLUDED.sample_event_json`,
        [
          entry.name,
          entry.ownerArea,
          entry.description,
          entry.piiLevel,
          JSON.stringify(entry.requiredPurposes),
          entry.schemaVersion,
          JSON.stringify(entry.schemaJson),
          JSON.stringify(entry.sampleEventJson)
        ]
      );
    }

    const seedFlag = await client.query(
      `SELECT 1 FROM audit_log WHERE action = 'seed.analytics' LIMIT 1`
    );
    const shouldGenerateData = forceSeed || seedFlag.rowCount === 0;
    const users: { id: string }[] = [];

    if (shouldGenerateData) {
      const userCount = random(120, 220);
      for (let i = 0; i < userCount; i += 1) {
        const first = pick(FIRST_NAMES);
        const last = pick(LAST_NAMES);
        const email = `${first}.${last}.${i}@imperium.fake`.toLowerCase();
        const result = await client.query<{ id: string }>(
          `INSERT INTO users (email, email_normalized, name, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'active', $4, $4)
           ON CONFLICT (email_normalized)
           DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [
            email,
            normalizeEmail(email),
            `${first} ${last}`,
            randomDateInLastDays(60)
          ]
        );
        users.push(result.rows[0]);

        await client.query(
          `INSERT INTO consents (workspace_id, user_id, version_id, granted, purposes, source, created_at)
           VALUES ($1, $2, $3, true, $4::jsonb, 'web', $5)`,
          [
            workspaceId,
            result.rows[0].id,
            consentVersionId,
            JSON.stringify(["analytics", "personalization"]),
            randomDateInLastDays(30)
          ]
        );

        await client.query(
          `INSERT INTO attribution (workspace_id, user_id, first_touch, last_touch)
           VALUES ($1, $2, $3::jsonb, $4::jsonb)
           ON CONFLICT (workspace_id, user_id)
           DO UPDATE SET last_touch = EXCLUDED.last_touch`,
          [
            workspaceId,
            result.rows[0].id,
            JSON.stringify({
              utm_source: pick(UTM_SOURCES),
              utm_campaign: pick(UTM_CAMPAIGNS)
            }),
            JSON.stringify({
              utm_source: pick(UTM_SOURCES),
              utm_campaign: pick(UTM_CAMPAIGNS)
            })
          ]
        );
      }

      const eventNames = eventCatalog.map((entry) => entry.name);
      const totalEvents = random(2500, 7000);
      for (let i = 0; i < totalEvents; i += 1) {
        const user = pick(users);
        const eventName = pick(eventNames);
        const eventTime = randomDateInLastDays(30);
        await client.query(
          `INSERT INTO events (workspace_id, event_id, event_name, schema_version, event_time, user_id, source, properties)
           VALUES ($1, $2, $3, 1, $4, $5, 'web', $6::jsonb)
           ON CONFLICT (workspace_id, event_id) DO NOTHING`,
          [
            workspaceId,
            crypto.randomUUID(),
            eventName,
            eventTime,
            user.id,
            JSON.stringify({})
          ]
        );
      }

      const conversionCount = random(150, 400);
      for (let i = 0; i < conversionCount; i += 1) {
        const user = pick(users);
        const occurredAt = randomDateInLastDays(30);
        await client.query(
          `INSERT INTO conversion_ledger
           (workspace_id, user_id, conversion_name, occurred_at, value_cents, currency, dedupe_key, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'system')
           ON CONFLICT (workspace_id, conversion_name, dedupe_key) DO NOTHING`,
          [
            workspaceId,
            user.id,
            "subscription_started",
            occurredAt,
            random(4900, 14900),
            "BRL",
            crypto.randomUUID()
          ]
        );
      }
    }


    const audienceDefinitions = [
      {
        name: "Engajados 7d",
        description: "Usuarios com eventos nos ultimos 7 dias.",
        definition_json: {
          event: { name: "auth.login_completed", within_days: 7 }
        }
      },
      {
        name: "Conversores 30d",
        description: "Usuarios com conversao nos ultimos 30 dias.",
        definition_json: {
          conversion: { name: "subscription_started", within_days: 30 }
        }
      },
      {
        name: "Campanha Imperium",
        description: "Usuarios vindos da campanha imperium-launch.",
        definition_json: { attr: { utm_campaign_in: ["imperium-launch"] } }
      },
      {
        name: "Recem cadastrados",
        description: "Usuarios criados recentemente.",
        definition_json: { user: { created_within_days: 14 } }
      },
      {
        name: "Consentimento Marketing",
        description: "Usuarios com consentimento de marketing.",
        definition_json: { consent: { purpose_required: ["marketing"] } }
      }
    ];

    for (const audience of audienceDefinitions) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO audience_definitions
         (workspace_id, name, description, definition_json, created_by_user_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (workspace_id, name)
         DO UPDATE SET description = EXCLUDED.description,
                       definition_json = EXCLUDED.definition_json
         RETURNING id`,
        [
          workspaceId,
          audience.name,
          audience.description,
          JSON.stringify(audience.definition_json),
          adminUserId
        ]
      );

      const audienceId =
        inserted.rows[0]?.id ??
        (
          await client.query<{ id: string }>(
            `SELECT id FROM audience_definitions WHERE workspace_id = $1 AND name = $2`,
            [workspaceId, audience.name]
          )
        ).rows[0]?.id;

      if (audienceId) {
        const sql = offsetSql(
          buildAudienceSql(audience.definition_json as AudienceRule, workspaceId),
          1
        );
        await client.query(
          `DELETE FROM audience_memberships WHERE audience_id = $1`,
          [audienceId]
        );
        await client.query(
          `INSERT INTO audience_memberships (audience_id, user_id, computed_at)
           SELECT $1, user_id, now()
           FROM (${sql.text}) AS audience_ids`,
          [audienceId, ...sql.values]
        );
      }
    }

    if (shouldGenerateData) {
      await client.query(
        `INSERT INTO audit_log (workspace_id, actor_user_id, action, resource_type)
         VALUES ($1, $2, 'seed.analytics', 'seed')`,
        [workspaceId, adminUserId]
      );
    }

    await client.query("COMMIT");
    const startAgg = new Date();
    startAgg.setDate(startAgg.getDate() - 30);
    await aggregateDaily(workspaceId, startAgg, new Date());
    await analyticsQuery(`SELECT $1 AS workspace_id`, [workspaceId]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (process.env.RUN_ANALYTICS_SEED === "true") {
  seedAnalytics()
    .then(() => {
      console.log("Analytics seed completed.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
