import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ensureDatabasePath = (dbPath) => {
  if (dbPath === ":memory:") return;
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
};

export const createDatabase = (dbPath) => {
  ensureDatabasePath(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      email TEXT,
      name TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      UNIQUE(provider, provider_account_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_events (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      provider TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_emails (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      name TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  const statements = {
    insertUser: db.prepare(
      `INSERT INTO users (id, email, name, avatar, created_at, last_login_at)
       VALUES (@id, @email, @name, @avatar, @created_at, @last_login_at)`
    ),
    updateUserLogin: db.prepare(
      `UPDATE users SET last_login_at = @last_login_at, name = @name, avatar = @avatar
       WHERE id = @id`
    ),
    findUserByEmail: db.prepare(
      `SELECT * FROM users WHERE email = @email`
    ),
    findUserById: db.prepare(
      `SELECT * FROM users WHERE id = @id`
    ),
    insertProvider: db.prepare(
      `INSERT INTO auth_providers
       (id, user_id, provider, provider_account_id, email, name, avatar, created_at, last_login_at)
       VALUES (@id, @user_id, @provider, @provider_account_id, @email, @name, @avatar, @created_at, @last_login_at)`
    ),
    updateProviderLogin: db.prepare(
      `UPDATE auth_providers
       SET last_login_at = @last_login_at, email = @email, name = @name, avatar = @avatar
       WHERE id = @id`
    ),
    findProvider: db.prepare(
      `SELECT * FROM auth_providers WHERE provider = @provider AND provider_account_id = @provider_account_id`
    ),
    insertEvent: db.prepare(
      `INSERT INTO auth_events (id, event, provider, created_at)
       VALUES (@id, @event, @provider, @created_at)`
    ),
    insertPendingEmail: db.prepare(
      `INSERT INTO pending_emails (id, provider, provider_account_id, name, avatar, created_at, expires_at)
       VALUES (@id, @provider, @provider_account_id, @name, @avatar, @created_at, @expires_at)`
    ),
    findPendingEmail: db.prepare(
      `SELECT * FROM pending_emails WHERE id = @id`
    ),
    deletePendingEmail: db.prepare(
      `DELETE FROM pending_emails WHERE id = @id`
    ),
    providerStats: db.prepare(
      `SELECT provider,
        SUM(CASE WHEN event = 'oauth_click' THEN 1 ELSE 0 END) AS clicks,
        SUM(CASE WHEN event = 'oauth_success' THEN 1 ELSE 0 END) AS success
       FROM auth_events
       WHERE provider IS NOT NULL
       GROUP BY provider
       ORDER BY provider`
    ),
  };

  const nowIso = () => new Date().toISOString();

  const createUser = ({ email, name, avatar }) => {
    const timestamp = nowIso();
    const user = {
      id: randomUUID(),
      email,
      name,
      avatar,
      created_at: timestamp,
      last_login_at: timestamp,
    };
    statements.insertUser.run(user);
    return user;
  };

  const updateUserLogin = ({ id, name, avatar }) => {
    statements.updateUserLogin.run({
      id,
      name,
      avatar,
      last_login_at: nowIso(),
    });
  };

  const findUserByEmail = (email) => {
    if (!email) return null;
    return statements.findUserByEmail.get({ email: email.toLowerCase() }) ?? null;
  };

  const findProvider = (provider, providerAccountId) => {
    return (
      statements.findProvider.get({
        provider,
        provider_account_id: providerAccountId,
      }) ?? null
    );
  };

  const upsertProvider = ({
    userId,
    provider,
    providerAccountId,
    email,
    name,
    avatar,
  }) => {
    const existing = findProvider(provider, providerAccountId);
    if (existing) {
      statements.updateProviderLogin.run({
        id: existing.id,
        email,
        name,
        avatar,
        last_login_at: nowIso(),
      });
      return existing;
    }
    const timestamp = nowIso();
    const record = {
      id: randomUUID(),
      user_id: userId,
      provider,
      provider_account_id: providerAccountId,
      email,
      name,
      avatar,
      created_at: timestamp,
      last_login_at: timestamp,
    };
    statements.insertProvider.run(record);
    return record;
  };

  const recordEvent = (event, provider) => {
    statements.insertEvent.run({
      id: randomUUID(),
      event,
      provider: provider ?? null,
      created_at: nowIso(),
    });
  };

  const createPendingEmail = ({ provider, providerAccountId, name, avatar }) => {
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 15).toISOString();
    statements.insertPendingEmail.run({
      id: token,
      provider,
      provider_account_id: providerAccountId,
      name,
      avatar,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    });
    return token;
  };

  const consumePendingEmail = (token) => {
    const record = statements.findPendingEmail.get({ id: token });
    if (!record) return null;
    if (new Date(record.expires_at) < new Date()) {
      statements.deletePendingEmail.run({ id: token });
      return null;
    }
    statements.deletePendingEmail.run({ id: token });
    return record;
  };

  const getProviderStats = () => {
    return statements.providerStats.all();
  };

  return {
    db,
    createUser,
    updateUserLogin,
    findUserByEmail,
    findProvider,
    upsertProvider,
    recordEvent,
    createPendingEmail,
    consumePendingEmail,
    getProviderStats,
  };
};

