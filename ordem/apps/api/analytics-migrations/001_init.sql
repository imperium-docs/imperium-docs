CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  email_normalized text UNIQUE,
  email_verified_at timestamptz,
  name text,
  avatar_url text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  email_at_provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_identities_user_id ON identities(user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON workspace_members(role);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ip inet,
  user_agent text,
  device_id text
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_last_seen ON sessions(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_last_seen ON sessions(workspace_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS consent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  content_markdown text NOT NULL,
  content_hash text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES consent_versions(id) ON DELETE CASCADE,
  granted boolean NOT NULL,
  purposes jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_consents_user_created ON consents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS event_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  owner_area text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  pii_level text NOT NULL DEFAULT 'none',
  required_purposes jsonb NOT NULL DEFAULT '["analytics"]'::jsonb,
  schema_version int NOT NULL DEFAULT 1,
  schema_json jsonb NOT NULL,
  sample_event_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event_name text NOT NULL,
  schema_version int NOT NULL,
  event_time timestamptz NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  source text NOT NULL,
  properties jsonb,
  context jsonb,
  ip inet,
  user_agent text,
  UNIQUE (workspace_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(event_name, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_workspace_time ON events(workspace_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_properties_gin ON events USING gin(properties);
CREATE INDEX IF NOT EXISTS idx_events_context_gin ON events USING gin(context);

CREATE TABLE IF NOT EXISTS attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_touch jsonb,
  last_touch jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversion_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  conversion_name text NOT NULL,
  occurred_at timestamptz NOT NULL,
  value_cents int,
  currency text,
  dedupe_key text NOT NULL,
  attribution_snapshot jsonb,
  properties jsonb,
  source text NOT NULL,
  UNIQUE (workspace_id, conversion_name, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_conversion_name_time ON conversion_ledger(conversion_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_user_time ON conversion_ledger(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audience_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  definition_json jsonb NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS audience_memberships (
  audience_id uuid NOT NULL REFERENCES audience_definitions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (audience_id, user_id)
);

CREATE TABLE IF NOT EXISTS audience_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  audience_id uuid NOT NULL REFERENCES audience_definitions(id) ON DELETE CASCADE,
  export_type text NOT NULL,
  storage_provider text NOT NULL,
  file_path text NOT NULL,
  row_count int NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_created ON audit_log(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text,
  merged_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_user_id)
);

CREATE TABLE IF NOT EXISTS user_aliases (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alias_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, alias_user_id)
);

CREATE TABLE IF NOT EXISTS event_daily_agg (
  date date NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  count int NOT NULL,
  unique_users_count int NOT NULL,
  PRIMARY KEY (date, workspace_id, event_name)
);

CREATE TABLE IF NOT EXISTS conversion_daily_agg (
  date date NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversion_name text NOT NULL,
  count int NOT NULL,
  value_cents_sum int NOT NULL,
  PRIMARY KEY (date, workspace_id, conversion_name)
);
