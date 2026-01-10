
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import Ajv, { type Options, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import argon2 from "argon2";
import fs from "node:fs";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { analyticsQuery, analyticsTransaction } from "../analytics/db.js";
import { hasPII } from "../analytics/pii-guard.js";
import { normalizeEmail, hashEmail } from "../analytics/utils.js";
import { signAdminToken, verifyAdminToken } from "../analytics/admin-auth.js";
import {
  buildAudienceSql,
  offsetSql,
  type AudienceRule
} from "../analytics/audiences.js";
import { aggregateDaily } from "../analytics/aggregates.js";
import { resolveDefaultWorkspaceId } from "../analytics/workspace.js";
import { loadEnv } from "../config.js";

const adminCookieName = "imperium_admin";
const catalogCache = new Map<
  string,
  {
    updatedAt: number;
    schemaVersion: number;
    enabled: boolean;
    piiLevel: string;
    requiredPurposes: string[];
    schemaJson: Record<string, unknown>;
    validator: ValidateFunction;
  }
>();

type AjvInstance = import("ajv").default;
type AjvConstructor = new (options?: Options) => AjvInstance;

const AjvCtor = Ajv as unknown as AjvConstructor;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const applyFormats = addFormats as unknown as (instance: AjvInstance) => void;
applyFormats(ajv);

const EventPayloadSchema = z.object({
  event_id: z.string().uuid(),
  event_name: z.string().min(1),
  schema_version: z.coerce.number().int().default(1),
  event_time: z.string().optional(),
  user_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  device_id: z.string().optional(),
  source: z.enum(["web", "app", "api"]).default("web"),
  properties: z.record(z.any()).optional(),
  context: z.record(z.any()).optional()
});

const IngestSchema = z.union([
  EventPayloadSchema.extend({
    workspace_id: z.string().uuid().optional()
  }),
  z.object({
    workspace_id: z.string().uuid().optional(),
    events: z.array(EventPayloadSchema).min(1)
  })
]);

const ConsentSchema = z.object({
  user_id: z.string().uuid(),
  version: z.string().min(1),
  granted: z.boolean(),
  purposes: z.array(z.string()).default([]),
  source: z.enum(["web", "app", "api"]).default("web")
});

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

function dateStart(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function parseRange(query: Record<string, string | undefined>) {
  const now = new Date();
  const range = query.range;
  const toInput = query.to ? new Date(query.to) : now;
  const to = dateStart(toInput);
  let days = 7;
  if (range === "30d") days = 30;
  if (range === "7d") days = 7;
  const fromInput = query.from ? new Date(query.from) : addDays(to, -days + 1);
  const from = dateStart(fromInput);
  const endExclusive = addDays(to, 1);
  const prevEnd = from;
  const prevStart = addDays(prevEnd, -days);
  return { from, endExclusive, prevStart, prevEnd };
}

function percentageDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

async function loadCatalogEntry(eventName: string) {
  const cached = catalogCache.get(eventName);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 5 * 60 * 1000) return cached;
  const rows = await analyticsQuery<{
    schema_version: number;
    enabled: boolean;
    pii_level: string;
    required_purposes: string[];
    schema_json: Record<string, unknown>;
  }>(
    `SELECT schema_version, enabled, pii_level, required_purposes, schema_json
     FROM event_catalog
     WHERE name = $1`,
    [eventName]
  );
  if (!rows[0]) return null;
  const validator = ajv.compile(rows[0].schema_json);
  const requiredPurposes = Array.isArray(rows[0].required_purposes)
    ? rows[0].required_purposes
    : [];
  const entry = {
    updatedAt: now,
    schemaVersion: rows[0].schema_version,
    enabled: rows[0].enabled,
    piiLevel: rows[0].pii_level,
    requiredPurposes,
    schemaJson: rows[0].schema_json,
    validator
  };
  catalogCache.set(eventName, entry);
  return entry;
}

async function resolveWorkspaceId(bodyWorkspaceId?: string) {
  if (bodyWorkspaceId) return bodyWorkspaceId;
  return resolveDefaultWorkspaceId();
}

async function getLatestConsent(userId: string) {
  const rows = await analyticsQuery<{
    granted: boolean;
    purposes: string[];
  }>(
    `SELECT granted, purposes
     FROM consents
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

async function recordAudit(params: {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await analyticsQuery(
    `INSERT INTO audit_log
     (workspace_id, actor_user_id, action, resource_type, resource_id, before, after, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [
      params.workspaceId,
      params.actorUserId ?? null,
      params.action,
      params.resourceType,
      params.resourceId ?? null,
      params.before ? JSON.stringify(params.before) : null,
      params.after ? JSON.stringify(params.after) : null,
      params.ip ?? null,
      params.userAgent ?? null
    ]
  );
}

function buildS3Client() {
  const env = loadEnv();
  return new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    credentials: env.STORAGE_ACCESS_KEY_ID
      ? {
          accessKeyId: env.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY || ""
        }
      : undefined
  });
}

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const env = loadEnv();

  app.post("/api/events", async (request, reply) => {
    const parsed = IngestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid payload." });
    }
    const payload = parsed.data;
    const events = "events" in payload ? payload.events : [payload];
    const workspaceId = await resolveWorkspaceId(
      "workspace_id" in payload ? payload.workspace_id : undefined
    );
    if (!workspaceId) {
      return reply.status(400).send({ message: "Workspace not configured." });
    }
    const results: { event_id: string; status: string }[] = [];

    for (const event of events) {
      if (hasPII(event.properties ?? null) || hasPII(event.context ?? null)) {
        results.push({ event_id: event.event_id, status: "pii_blocked" });
        continue;
      }
      const catalogEntry = await loadCatalogEntry(event.event_name);
      if (!catalogEntry || !catalogEntry.enabled) {
        results.push({ event_id: event.event_id, status: "unknown_event" });
        continue;
      }
      if (catalogEntry.schemaVersion !== event.schema_version) {
        results.push({ event_id: event.event_id, status: "schema_mismatch" });
        continue;
      }
      const isValid = catalogEntry.validator(event.properties ?? {});
      if (!isValid) {
        results.push({ event_id: event.event_id, status: "schema_invalid" });
        continue;
      }

      if (catalogEntry.requiredPurposes.length) {
        if (!event.user_id) {
          results.push({ event_id: event.event_id, status: "consent_required" });
          continue;
        }
        const consent = await getLatestConsent(event.user_id);
        const granted =
          consent?.granted &&
          catalogEntry.requiredPurposes.every((purpose) =>
            consent.purposes?.includes(purpose)
          );
        if (!granted) {
          results.push({ event_id: event.event_id, status: "consent_required" });
          continue;
        }
      }

      const eventTime = event.event_time ? new Date(event.event_time) : new Date();
      const ip = request.ip;
      const userAgent = request.headers["user-agent"] || null;

      await analyticsTransaction(async (client) => {
        if (event.user_id) {
          await client.query(
            `INSERT INTO users (id, status, created_at, updated_at)
             VALUES ($1, 'active', now(), now())
             ON CONFLICT (id) DO NOTHING`,
            [event.user_id]
          );
        }
        if (event.session_id) {
          await client.query(
            `INSERT INTO sessions
             (id, workspace_id, user_id, started_at, last_seen_at, ip, user_agent, device_id)
             VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
             ON CONFLICT (id)
             DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at,
                           user_id = COALESCE(EXCLUDED.user_id, sessions.user_id),
                           ip = COALESCE(EXCLUDED.ip, sessions.ip),
                           user_agent = COALESCE(EXCLUDED.user_agent, sessions.user_agent),
                           device_id = COALESCE(EXCLUDED.device_id, sessions.device_id)`,
            [
              event.session_id,
              workspaceId,
              event.user_id ?? null,
              eventTime,
              ip,
              userAgent,
              event.device_id ?? null
            ]
          );
        }

        const insert = await client.query(
          `INSERT INTO events
           (workspace_id, event_id, event_name, schema_version, event_time, user_id, session_id, source, properties, context, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
           ON CONFLICT (workspace_id, event_id) DO NOTHING`,
          [
            workspaceId,
            event.event_id,
            event.event_name,
            event.schema_version,
            eventTime,
            event.user_id ?? null,
            event.session_id ?? null,
            event.source,
            JSON.stringify(event.properties ?? {}),
            JSON.stringify(event.context ?? {}),
            ip,
            userAgent
          ]
        );

        if (insert.rowCount === 0) {
          results.push({ event_id: event.event_id, status: "deduped" });
          return;
        }

        if (event.event_name === "system.attribution_captured" && event.user_id) {
          const props = event.properties ?? {};
          const touch = props.touch === "first" ? "first" : "last";
          await client.query(
            `INSERT INTO attribution (workspace_id, user_id, first_touch, last_touch)
             VALUES ($1, $2, $3::jsonb, $4::jsonb)
             ON CONFLICT (workspace_id, user_id)
             DO UPDATE SET
               first_touch = COALESCE(attribution.first_touch, EXCLUDED.first_touch),
               last_touch = EXCLUDED.last_touch,
               updated_at = now()`,
            [
              workspaceId,
              event.user_id,
              touch === "first" ? JSON.stringify(props) : null,
              JSON.stringify(props)
            ]
          );
        }

        if (
          event.event_name === "billing.subscription_started" ||
          event.event_name === "billing.checkout_completed"
        ) {
          const props = event.properties ?? {};
          const conversionName =
            event.event_name === "billing.subscription_started"
              ? "subscription_started"
              : "checkout_completed";
          await client.query(
            `INSERT INTO conversion_ledger
             (workspace_id, user_id, session_id, conversion_name, occurred_at, value_cents, currency, dedupe_key, properties, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'system')
             ON CONFLICT (workspace_id, conversion_name, dedupe_key) DO NOTHING`,
            [
              workspaceId,
              event.user_id ?? null,
              event.session_id ?? null,
              conversionName,
              eventTime,
              typeof props.price_cents === "number" ? props.price_cents : null,
              typeof props.currency === "string" ? props.currency : null,
              event.event_id,
              JSON.stringify(props)
            ]
          );
        }
      });

      results.push({ event_id: event.event_id, status: "accepted" });
    }

    return reply.send({ results });
  });

  app.get("/api/consent/version/current", async (_request, reply) => {
    const rows = await analyticsQuery<{
      version: string;
      content_markdown: string;
      content_hash: string;
      published_at: string;
    }>(
      `SELECT version, content_markdown, content_hash, published_at
       FROM consent_versions
       ORDER BY published_at DESC
       LIMIT 1`
    );
    if (!rows[0]) {
      return reply.status(404).send({ message: "Consent version not found." });
    }
    return reply.send(rows[0]);
  });

  app.post("/api/consent", async (request, reply) => {
    const parsed = ConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid consent payload." });
    }
    const payload = parsed.data;
    const version = await analyticsQuery<{ id: string }>(
      "SELECT id FROM consent_versions WHERE version = $1",
      [payload.version]
    );
    if (!version[0]) {
      return reply.status(404).send({ message: "Consent version not found." });
    }
    const workspaceId = await resolveWorkspaceId();
    if (!workspaceId) {
      return reply.status(400).send({ message: "Workspace not configured." });
    }

    await analyticsTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, status, created_at, updated_at)
         VALUES ($1, 'active', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [payload.user_id]
      );
      await client.query(
        `INSERT INTO consents
         (workspace_id, user_id, version_id, granted, purposes, source, created_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), $7, $8)`,
        [
          workspaceId,
          payload.user_id,
          version[0].id,
          payload.granted,
          JSON.stringify(payload.purposes),
          payload.source,
          request.ip,
          request.headers["user-agent"] || null
        ]
      );

      await client.query(
        `INSERT INTO events
         (workspace_id, event_id, event_name, schema_version, event_time, user_id, source, properties)
         VALUES ($1, gen_random_uuid(), 'consent.updated', 1, now(), $2, 'system', $3::jsonb)`,
        [
          workspaceId,
          payload.user_id,
          JSON.stringify({
            version: payload.version,
            granted: payload.granted,
            purposes: payload.purposes
          })
        ]
      );
    });

    return reply.send({ ok: true });
  });

  app.post("/api/admin/login", async (request, reply) => {
    const parsed = AdminLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid credentials." });
    }
    const emailNormalized = normalizeEmail(parsed.data.email);
    if (!emailNormalized) {
      return reply.status(400).send({ message: "Invalid credentials." });
    }
    const rows = await analyticsQuery<{
      id: string;
      email: string;
      status: string;
      password_hash: string;
      workspace_id: string;
      role: "admin" | "analyst" | "support";
    }>(
      `SELECT u.id, u.email, u.status, c.password_hash, m.workspace_id, m.role
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
       JOIN workspace_members m ON m.user_id = u.id
       WHERE u.email_normalized = $1
       LIMIT 1`,
      [emailNormalized]
    );
    const user = rows[0];
    if (!user || user.status !== "active") {
      return reply.status(401).send({ message: "Unauthorized." });
    }
    const valid = await argon2.verify(user.password_hash, parsed.data.password);
    if (!valid) {
      return reply.status(401).send({ message: "Unauthorized." });
    }

    await analyticsQuery(
      "UPDATE users SET last_login_at = now() WHERE id = $1",
      [user.id]
    );

    const token = await signAdminToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspace_id
    });
    reply.setCookie(adminCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/"
    });
    return reply.send({
      user: { id: user.id, email: user.email, role: user.role }
    });
  });

  app.post("/api/admin/logout", async (_request, reply) => {
    reply.clearCookie(adminCookieName, { path: "/" });
    return reply.send({ ok: true });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/admin")) return;
    if (request.method === "POST" && request.url === "/api/admin/login") return;
    const token = request.cookies?.[adminCookieName];
    if (!token) return reply.status(401).send({ message: "Unauthorized." });
    try {
      const payload = await verifyAdminToken(token);
      request.adminUser = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        workspaceId: payload.workspaceId
      };
    } catch {
      return reply.status(401).send({ message: "Unauthorized." });
    }
  });

  function requireRole(
    request: typeof app extends { } ? any : any,
    reply: typeof app extends { } ? any : any,
    roles: Array<"admin" | "analyst" | "support">
  ) {
    const user = request.adminUser;
    if (!user || !roles.includes(user.role)) {
      reply.status(403).send({ message: "Forbidden." });
      return false;
    }
    return true;
  }

  app.get("/api/admin/me", async (request, reply) => {
    if (!request.adminUser) {
      return reply.status(401).send({ message: "Unauthorized." });
    }
    return reply.send({ user: request.adminUser });
  });

  app.get("/api/admin/overview", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const { from, endExclusive, prevStart, prevEnd } = parseRange(
      request.query as Record<string, string | undefined>
    );
    const workspaceId = request.adminUser!.workspaceId;

    const [newUsers] = await analyticsQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE created_at >= $1 AND created_at < $2`,
      [from, endExclusive]
    );
    const [newUsersPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE created_at >= $1 AND created_at < $2`,
      [prevStart, prevEnd]
    );

    const [activeUsers] = await analyticsQuery<{ count: number }>(
      `SELECT COUNT(DISTINCT user_id)::int AS count FROM events
       WHERE workspace_id = $1 AND event_time >= $2 AND event_time < $3 AND user_id IS NOT NULL`,
      [workspaceId, from, endExclusive]
    );
    const [activeUsersPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COUNT(DISTINCT user_id)::int AS count FROM events
       WHERE workspace_id = $1 AND event_time >= $2 AND event_time < $3 AND user_id IS NOT NULL`,
      [workspaceId, prevStart, prevEnd]
    );

    const [signups] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "auth.signup_completed", from, endExclusive]
    );
    const [signupsPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "auth.signup_completed", prevStart, prevEnd]
    );

    const [paywall] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "academia.paywall_hit", from, endExclusive]
    );
    const [paywallPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "academia.paywall_hit", prevStart, prevEnd]
    );

    const [checkouts] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "billing.checkout_started", from, endExclusive]
    );
    const [checkoutsPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "billing.checkout_started", prevStart, prevEnd]
    );

    const [subs] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM conversion_daily_agg
       WHERE workspace_id = $1 AND conversion_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "subscription_started", from, endExclusive]
    );
    const [subsPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM conversion_daily_agg
       WHERE workspace_id = $1 AND conversion_name = $2 AND date >= $3 AND date < $4`,
      [workspaceId, "subscription_started", prevStart, prevEnd]
    );

    return reply.send({
      cards: [
        {
          key: "new_users",
          label: "New Users",
          value: newUsers?.count ?? 0,
          delta: percentageDelta(newUsers?.count ?? 0, newUsersPrev?.count ?? 0)
        },
        {
          key: "active_users",
          label: "Active Users",
          value: activeUsers?.count ?? 0,
          delta: percentageDelta(
            activeUsers?.count ?? 0,
            activeUsersPrev?.count ?? 0
          )
        },
        {
          key: "signups",
          label: "Signups",
          value: signups?.count ?? 0,
          delta: percentageDelta(signups?.count ?? 0, signupsPrev?.count ?? 0)
        },
        {
          key: "paywall_hits",
          label: "Paywall Hits",
          value: paywall?.count ?? 0,
          delta: percentageDelta(paywall?.count ?? 0, paywallPrev?.count ?? 0)
        },
        {
          key: "checkouts_started",
          label: "Checkouts Started",
          value: checkouts?.count ?? 0,
          delta: percentageDelta(
            checkouts?.count ?? 0,
            checkoutsPrev?.count ?? 0
          )
        },
        {
          key: "subscriptions_started",
          label: "Subscriptions Started",
          value: subs?.count ?? 0,
          delta: percentageDelta(subs?.count ?? 0, subsPrev?.count ?? 0)
        }
      ]
    });
  });

  app.get("/api/admin/top-campaigns", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const { from, endExclusive } = parseRange(
      request.query as Record<string, string | undefined>
    );
    const workspaceId = request.adminUser!.workspaceId;
    const rows = await analyticsQuery<{
      utm_source: string;
      utm_campaign: string;
      signups: number;
      subs: number;
    }>(
      `
      WITH signup_users AS (
        SELECT DISTINCT user_id
        FROM events
        WHERE workspace_id = $1
          AND event_name = 'auth.signup_completed'
          AND event_time >= $2
          AND event_time < $3
          AND user_id IS NOT NULL
      ),
      conversions AS (
        SELECT DISTINCT user_id
        FROM conversion_ledger
        WHERE workspace_id = $1
          AND conversion_name = 'subscription_started'
          AND occurred_at >= $2
          AND occurred_at < $3
          AND user_id IS NOT NULL
      ),
      attrib AS (
        SELECT user_id,
               COALESCE(last_touch->>'utm_source', 'unknown') AS utm_source,
               COALESCE(last_touch->>'utm_campaign', 'unknown') AS utm_campaign
        FROM attribution
        WHERE workspace_id = $1
      )
      SELECT
        COALESCE(attrib.utm_source, 'unknown') AS utm_source,
        COALESCE(attrib.utm_campaign, 'unknown') AS utm_campaign,
        COUNT(DISTINCT signup_users.user_id)::int AS signups,
        COUNT(DISTINCT conversions.user_id)::int AS subs
      FROM signup_users
      LEFT JOIN attrib ON attrib.user_id = signup_users.user_id
      LEFT JOIN conversions ON conversions.user_id = signup_users.user_id
      GROUP BY utm_source, utm_campaign
      ORDER BY subs DESC, signups DESC
      LIMIT 5
      `,
      [workspaceId, from, endExclusive]
    );
    return reply.send(
      rows.map((row) => ({
        ...row,
        conv_rate: row.signups ? Number((row.subs / row.signups).toFixed(2)) : 0
      }))
    );
  });

  app.get("/api/admin/whats-changed", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const { from, endExclusive, prevStart, prevEnd } = parseRange(
      request.query as Record<string, string | undefined>
    );
    const workspaceId = request.adminUser!.workspaceId;
    const [signups] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = 'auth.signup_completed'
         AND date >= $2 AND date < $3`,
      [workspaceId, from, endExclusive]
    );
    const [signupsPrev] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = 'auth.signup_completed'
         AND date >= $2 AND date < $3`,
      [workspaceId, prevStart, prevEnd]
    );
    const signupDelta = percentageDelta(
      signups?.count ?? 0,
      signupsPrev?.count ?? 0
    );

    const [paywall] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = 'academia.paywall_hit'
         AND date >= $2 AND date < $3`,
      [workspaceId, from, endExclusive]
    );
    const [checkout] = await analyticsQuery<{ count: number }>(
      `SELECT COALESCE(SUM(count),0)::int AS count FROM event_daily_agg
       WHERE workspace_id = $1 AND event_name = 'billing.checkout_started'
         AND date >= $2 AND date < $3`,
      [workspaceId, from, endExclusive]
    );
    const funnelDrop = paywall?.count
      ? Math.round(
          ((paywall.count - (checkout?.count ?? 0)) / paywall.count) * 100
        )
      : 0;

    const campaigns = await analyticsQuery<{
      utm_campaign: string;
      signups: number;
      subs: number;
    }>(
      `
      WITH signup_users AS (
        SELECT DISTINCT user_id
        FROM events
        WHERE workspace_id = $1
          AND event_name = 'auth.signup_completed'
          AND event_time >= $2
          AND event_time < $3
          AND user_id IS NOT NULL
      ),
      conversions AS (
        SELECT DISTINCT user_id
        FROM conversion_ledger
        WHERE workspace_id = $1
          AND conversion_name = 'subscription_started'
          AND occurred_at >= $2
          AND occurred_at < $3
          AND user_id IS NOT NULL
      ),
      attrib AS (
        SELECT user_id,
               COALESCE(last_touch->>'utm_campaign', 'unknown') AS utm_campaign
        FROM attribution
        WHERE workspace_id = $1
      )
      SELECT
        COALESCE(attrib.utm_campaign, 'unknown') AS utm_campaign,
        COUNT(DISTINCT signup_users.user_id)::int AS signups,
        COUNT(DISTINCT conversions.user_id)::int AS subs
      FROM signup_users
      LEFT JOIN attrib ON attrib.user_id = signup_users.user_id
      LEFT JOIN conversions ON conversions.user_id = signup_users.user_id
      GROUP BY utm_campaign
      HAVING COUNT(DISTINCT signup_users.user_id) >= 5
      ORDER BY (COUNT(DISTINCT conversions.user_id)::float / NULLIF(COUNT(DISTINCT signup_users.user_id),0)) DESC
      LIMIT 1
      `,
      [workspaceId, from, endExclusive]
    );

    const bestCampaign = campaigns[0];
    const bestConvRate = bestCampaign?.signups
      ? (bestCampaign.subs / bestCampaign.signups).toFixed(1)
      : "0";

    return reply.send([
      `Signups ${signupDelta >= 0 ? "up" : "down"} ${Math.abs(
        signupDelta
      )}% vs periodo anterior`,
      `Maior gargalo: paywall -> checkout (${funnelDrop}% queda)`,
      bestCampaign
        ? `Campanha vencedora: ${bestCampaign.utm_campaign} (${bestConvRate}x conv_rate)`
        : "Campanha vencedora: dados insuficientes"
    ]);
  });

  app.get("/api/admin/funnel", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const { from, endExclusive } = parseRange(
      request.query as Record<string, string | undefined>
    );
    const preset = (request.query as any).preset || "academia";
    const workspaceId = request.adminUser!.workspaceId;

    const presets: Record<string, { name: string; steps: string[] }> = {
      academia: {
        name: "Academia -> Assinatura",
        steps: [
          "academia.lesson_started",
          "academia.paywall_hit",
          "billing.checkout_started",
          "conversion:subscription_started"
        ]
      },
      atlas: {
        name: "Atlas -> Assinatura",
        steps: [
          "atlas.feed_viewed",
          "atlas.item_opened",
          "billing.checkout_started",
          "conversion:subscription_started"
        ]
      },
      alexandria: {
        name: "Alexandria -> Assinatura",
        steps: [
          "alexandria.series_viewed",
          "alexandria.episode_started",
          "billing.checkout_started",
          "conversion:subscription_started"
        ]
      }
    };

    const config = presets[preset] || presets.academia;
    const steps = [];

    for (const step of config.steps) {
      if (step.startsWith("conversion:")) {
        const conversionName = step.replace("conversion:", "");
        const [count] = await analyticsQuery<{ count: number }>(
          `SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id::text))::int AS count
           FROM conversion_ledger
           WHERE workspace_id = $1
             AND conversion_name = $2
             AND occurred_at >= $3
             AND occurred_at < $4`,
          [workspaceId, conversionName, from, endExclusive]
        );
        steps.push({
          name: conversionName,
          count: count?.count ?? 0
        });
      } else {
        const [count] = await analyticsQuery<{ count: number }>(
          `SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id::text))::int AS count
           FROM events
           WHERE workspace_id = $1
             AND event_name = $2
             AND event_time >= $3
             AND event_time < $4`,
          [workspaceId, step, from, endExclusive]
        );
        steps.push({
          name: step,
          count: count?.count ?? 0
        });
      }
    }

    return reply.send({ preset: config.name, steps });
  });

  app.get("/api/admin/events", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const query = request.query as Record<string, string | undefined>;
    const { from, endExclusive } = parseRange(query);
    const limit = Math.min(Number(query.limit) || 50, 200);
    const offset = Number(query.offset) || 0;
    const workspaceId = request.adminUser!.workspaceId;
    const nameFilter = query.event_name;
    const rows = await analyticsQuery(
      `
      SELECT id, event_name, event_time, user_id, session_id, source, properties, context
      FROM events
      WHERE workspace_id = $1
        AND event_time >= $2
        AND event_time < $3
        ${nameFilter ? "AND event_name = $4" : ""}
      ORDER BY event_time DESC
      LIMIT $5 OFFSET $6
      `,
      nameFilter
        ? [workspaceId, from, endExclusive, nameFilter, limit, offset]
        : [workspaceId, from, endExclusive, limit, offset]
    );
    return reply.send(rows);
  });

  app.get("/api/admin/users", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const query = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(query.limit) || 50, 200);
    const offset = Number(query.offset) || 0;
    const workspaceId = request.adminUser!.workspaceId;
    const rows = await analyticsQuery(
      `
      SELECT u.id, u.email, u.status, u.created_at, u.last_login_at,
             COALESCE(array_agg(DISTINCT i.provider) FILTER (WHERE i.provider IS NOT NULL), '{}') AS providers
      FROM users u
      LEFT JOIN identities i ON i.user_id = u.id
      WHERE u.id IN (
        SELECT user_id FROM workspace_members WHERE workspace_id = $1
        UNION
        SELECT user_id FROM events WHERE workspace_id = $1 AND user_id IS NOT NULL
        UNION
        SELECT user_id FROM consents WHERE workspace_id = $1
        UNION
        SELECT user_id FROM conversion_ledger WHERE workspace_id = $1 AND user_id IS NOT NULL
      )
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [workspaceId, limit, offset]
    );
    return reply.send(rows);
  });

  app.get("/api/admin/users/:id", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const userId = (request.params as any).id;
    const workspaceId = request.adminUser!.workspaceId;
    const [user] = await analyticsQuery(
      `SELECT id, email, status, created_at, last_login_at
       FROM users
       WHERE id = $1
         AND (
           EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = $2 AND user_id = $1)
           OR EXISTS (SELECT 1 FROM events WHERE workspace_id = $2 AND user_id = $1)
           OR EXISTS (SELECT 1 FROM consents WHERE workspace_id = $2 AND user_id = $1)
           OR EXISTS (SELECT 1 FROM conversion_ledger WHERE workspace_id = $2 AND user_id = $1)
         )`,
      [userId, workspaceId]
    );
    if (!user) return reply.status(404).send({ message: "User not found." });
    const identities = await analyticsQuery(
      `SELECT provider, provider_user_id, email_at_provider, created_at
       FROM identities WHERE user_id = $1`,
      [userId]
    );
    const consents = await analyticsQuery(
      `SELECT granted, purposes, created_at
       FROM consents WHERE user_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`,
      [userId, workspaceId]
    );
    const attribution = await analyticsQuery(
      `SELECT first_touch, last_touch, updated_at
       FROM attribution WHERE user_id = $1 AND workspace_id = $2`,
      [userId, workspaceId]
    );
    const ledger = await analyticsQuery(
      `SELECT conversion_name, occurred_at, value_cents, currency
       FROM conversion_ledger WHERE user_id = $1 AND workspace_id = $2 ORDER BY occurred_at DESC`,
      [userId, workspaceId]
    );
    const events = await analyticsQuery(
      `SELECT event_name, event_time, properties
       FROM events WHERE user_id = $1 AND workspace_id = $2 ORDER BY event_time DESC LIMIT 50`,
      [userId, workspaceId]
    );
    return reply.send({
      user,
      identities,
      consents,
      attribution,
      ledger,
      events
    });
  });

  app.post("/api/admin/users/merge", async (request, reply) => {
    if (!requireRole(request, reply, ["admin"])) return;
    const schema = z.object({
      source_user_id: z.string().uuid(),
      target_user_id: z.string().uuid(),
      reason: z.string().optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid payload." });
    }
    const { source_user_id, target_user_id, reason } = parsed.data;
    const workspaceId = request.adminUser!.workspaceId;

    await analyticsTransaction(async (client) => {
      await client.query(
        `DELETE FROM identities i
         USING identities t
         WHERE i.user_id = $1
           AND t.user_id = $2
           AND i.provider = t.provider
           AND i.provider_user_id = t.provider_user_id`,
        [source_user_id, target_user_id]
      );

      const tablesToUpdate = [
        "events",
        "sessions",
        "conversion_ledger",
        "audience_memberships",
        "consents"
      ];
      for (const table of tablesToUpdate) {
        await client.query(
          `UPDATE ${table} SET user_id = $1 WHERE user_id = $2`,
          [target_user_id, source_user_id]
        );
      }
      await client.query(
        `UPDATE identities SET user_id = $1 WHERE user_id = $2`,
        [target_user_id, source_user_id]
      );
      await client.query(
        `UPDATE attribution SET user_id = $1 WHERE user_id = $2`,
        [target_user_id, source_user_id]
      );

      await client.query(
        `INSERT INTO user_merges
         (workspace_id, source_user_id, target_user_id, reason, merged_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, source_user_id) DO NOTHING`,
        [
          workspaceId,
          source_user_id,
          target_user_id,
          reason ?? null,
          request.adminUser!.userId
        ]
      );
      await client.query(
        `INSERT INTO user_aliases
         (workspace_id, alias_user_id, canonical_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, alias_user_id) DO NOTHING`,
        [workspaceId, source_user_id, target_user_id]
      );
      await client.query(
        `UPDATE users SET status = 'merged', updated_at = now() WHERE id = $1`,
        [source_user_id]
      );
    });

    await recordAudit({
      workspaceId,
      actorUserId: request.adminUser!.userId,
      action: "user.merge",
      resourceType: "user",
      resourceId: source_user_id,
      after: { target_user_id, reason },
      ip: request.ip,
      userAgent: request.headers["user-agent"] || null
    });

    return reply.send({ ok: true });
  });

  app.get("/api/admin/audiences", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const workspaceId = request.adminUser!.workspaceId;
    const rows = await analyticsQuery(
      `
      SELECT a.id, a.name, a.description, a.updated_at,
             COUNT(m.user_id)::int AS members
      FROM audience_definitions a
      LEFT JOIN audience_memberships m ON m.audience_id = a.id
      WHERE a.workspace_id = $1
      GROUP BY a.id
      ORDER BY a.updated_at DESC
      `,
      [workspaceId]
    );
    return reply.send(rows);
  });

  app.post("/api/admin/audiences", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst"])) return;
    const schema = z.object({
      name: z.string().min(2),
      description: z.string().optional(),
      definition_json: z.record(z.any())
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid payload." });
    }
    const workspaceId = request.adminUser!.workspaceId;
    const rows = await analyticsQuery<{ id: string }>(
      `INSERT INTO audience_definitions
       (workspace_id, name, description, definition_json, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [
        workspaceId,
        parsed.data.name,
        parsed.data.description ?? null,
        JSON.stringify(parsed.data.definition_json),
        request.adminUser!.userId
      ]
    );
    await recordAudit({
      workspaceId,
      actorUserId: request.adminUser!.userId,
      action: "audience.create",
      resourceType: "audience",
      resourceId: rows[0].id,
      after: parsed.data,
      ip: request.ip,
      userAgent: request.headers["user-agent"] || null
    });
    return reply.send({ id: rows[0].id });
  });

  app.get("/api/admin/audiences/:id/preview", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const audienceId = (request.params as any).id;
    const [audience] = await analyticsQuery<{ definition_json: AudienceRule }>(
      `SELECT definition_json FROM audience_definitions WHERE id = $1`,
      [audienceId]
    );
    if (!audience) return reply.status(404).send({ message: "Not found." });
    const workspaceId = request.adminUser!.workspaceId;
    const sql = buildAudienceSql(audience.definition_json, workspaceId);
    const rows = await analyticsQuery(
      `SELECT u.id, u.email, u.status
       FROM users u
       WHERE u.id IN (${sql.text})
       LIMIT 10`,
      sql.values
    );
    return reply.send(rows);
  });

  app.post("/api/admin/audiences/:id/recompute", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst"])) return;
    const audienceId = (request.params as any).id;
    const [audience] = await analyticsQuery<{ definition_json: AudienceRule }>(
      `SELECT definition_json FROM audience_definitions WHERE id = $1`,
      [audienceId]
    );
    if (!audience) return reply.status(404).send({ message: "Not found." });
    const workspaceId = request.adminUser!.workspaceId;
    const sql = offsetSql(
      buildAudienceSql(audience.definition_json, workspaceId),
      1
    );

    await analyticsTransaction(async (client) => {
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
      await client.query(
        `UPDATE audience_definitions SET updated_at = now() WHERE id = $1`,
        [audienceId]
      );
    });

    await recordAudit({
      workspaceId,
      actorUserId: request.adminUser!.userId,
      action: "audience.recompute",
      resourceType: "audience",
      resourceId: audienceId,
      ip: request.ip,
      userAgent: request.headers["user-agent"] || null
    });

    return reply.send({ ok: true });
  });

  app.post("/api/admin/audiences/:id/exports", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst"])) return;
    const schema = z.object({
      export_type: z.enum(["hash_email_sha256", "csv", "json"])
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid payload." });
    }
    if (parsed.data.export_type !== "hash_email_sha256") {
      if (!requireRole(request, reply, ["admin"])) return;
    }

    const audienceId = (request.params as any).id;
    const [audience] = await analyticsQuery<{ name: string }>(
      `SELECT name FROM audience_definitions WHERE id = $1`,
      [audienceId]
    );
    if (!audience) return reply.status(404).send({ message: "Not found." });
    const workspaceId = request.adminUser!.workspaceId;

    const rows = await analyticsQuery<{
      email: string | null;
      id: string;
      granted: boolean | null;
      purposes: string[] | null;
    }>(
      `SELECT u.id, u.email, c.granted, c.purposes
       FROM audience_memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN LATERAL (
         SELECT granted, purposes
         FROM consents
         WHERE user_id = u.id AND workspace_id = $2
         ORDER BY created_at DESC
         LIMIT 1
       ) c ON true
       WHERE m.audience_id = $1`,
      [audienceId, workspaceId]
    );

    const exportRows: string[] = [];
    const requiresExplicitConsent =
      parsed.data.export_type === "csv" || parsed.data.export_type === "json";

    for (const row of rows) {
      if (!row.email) continue;
      if (requiresExplicitConsent) {
        const purposes = row.purposes || [];
        const allowed =
          row.granted &&
          (purposes.includes("email") || purposes.includes("marketing"));
        if (!allowed) continue;
      }
      if (parsed.data.export_type === "hash_email_sha256") {
        exportRows.push(hashEmail(normalizeEmail(row.email) || row.email));
      } else {
        exportRows.push(row.email);
      }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const filename = `${audience.name
      .replace(/\s+/g, "-")
      .toLowerCase()}-${Date.now()}.${
      parsed.data.export_type === "json" ? "json" : "csv"
    }`;
    const exportsDir = path.resolve(process.cwd(), env.ANALYTICS_EXPORTS_PATH);
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const filePath = path.join(exportsDir, filename);

    const payload =
      parsed.data.export_type === "json"
        ? JSON.stringify(exportRows, null, 2)
        : exportRows.join("\n");
    fs.writeFileSync(filePath, payload, "utf8");

    let storageProvider = env.STORAGE_PROVIDER;
    let storedPath = filePath;
    if (storageProvider !== "local") {
      if (!env.STORAGE_BUCKET) {
        return reply.status(400).send({ message: "Storage not configured." });
      }
      const client = buildS3Client();
      const key = `exports/${filename}`;
      await client.send(
        new PutObjectCommand({
          Bucket: env.STORAGE_BUCKET,
          Key: key,
          Body: payload,
          ContentType:
            parsed.data.export_type === "json"
              ? "application/json"
              : "text/csv"
        })
      );
      storedPath = key;
    }

    const [exportRow] = await analyticsQuery<{ id: string }>(
      `INSERT INTO audience_exports
       (workspace_id, audience_id, export_type, storage_provider, file_path, row_count, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        workspaceId,
        audienceId,
        parsed.data.export_type,
        storageProvider,
        storedPath,
        exportRows.length,
        request.adminUser!.userId,
        expiresAt
      ]
    );

    await recordAudit({
      workspaceId,
      actorUserId: request.adminUser!.userId,
      action: "audience.export",
      resourceType: "audience",
      resourceId: audienceId,
      after: {
        export_type: parsed.data.export_type,
        row_count: exportRows.length
      },
      ip: request.ip,
      userAgent: request.headers["user-agent"] || null
    });

    return reply.send({
      id: exportRow.id,
      expires_at: expiresAt
    });
  });

  app.get("/api/admin/exports/:id/download", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst"])) return;
    const exportId = (request.params as any).id;
    const [row] = await analyticsQuery<{
      export_type: string;
      storage_provider: string;
      file_path: string;
      expires_at: string | null;
    }>(
      `SELECT export_type, storage_provider, file_path, expires_at
       FROM audience_exports WHERE id = $1`,
      [exportId]
    );
    if (!row) return reply.status(404).send({ message: "Not found." });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return reply.status(410).send({ message: "Expired." });
    }
    if (row.storage_provider === "local") {
      if (!fs.existsSync(row.file_path)) {
        return reply.status(404).send({ message: "File missing." });
      }
      reply.type(row.export_type === "json" ? "application/json" : "text/csv");
      return reply.send(fs.createReadStream(row.file_path));
    }
    if (!env.STORAGE_BUCKET) {
      return reply.status(400).send({ message: "Storage not configured." });
    }
    const client = buildS3Client();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: row.file_path
      }),
      { expiresIn: 3600 }
    );
    return reply.send({ url });
  });

  app.get("/api/admin/conversions", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst", "support"])) return;
    const { from, endExclusive } = parseRange(
      request.query as Record<string, string | undefined>
    );
    const workspaceId = request.adminUser!.workspaceId;
    const rows = await analyticsQuery(
      `SELECT conversion_name, occurred_at, value_cents, currency, source
       FROM conversion_ledger
       WHERE workspace_id = $1
         AND occurred_at >= $2
         AND occurred_at < $3
       ORDER BY occurred_at DESC
       LIMIT 200`,
      [workspaceId, from, endExclusive]
    );
    return reply.send(rows);
  });

  app.get("/api/admin/audit", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst"])) return;
    const workspaceId = request.adminUser!.workspaceId;
    const rows = await analyticsQuery(
      `SELECT action, resource_type, resource_id, created_at, actor_user_id
       FROM audit_log
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [workspaceId]
    );
    return reply.send(rows);
  });

  app.post("/api/admin/aggregates/recompute", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "analyst"])) return;
    const schema = z.object({
      from: z.string(),
      to: z.string()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid payload." });
    }
    const workspaceId = request.adminUser!.workspaceId;
    const from = new Date(parsed.data.from);
    const to = addDays(new Date(parsed.data.to), 1);
    await aggregateDaily(workspaceId, from, to);
    await recordAudit({
      workspaceId,
      actorUserId: request.adminUser!.userId,
      action: "aggregate.recompute",
      resourceType: "aggregate",
      resourceId: `${from.toISOString()}_${to.toISOString()}`,
      ip: request.ip,
      userAgent: request.headers["user-agent"] || null
    });
    return reply.send({ ok: true });
  });
};
