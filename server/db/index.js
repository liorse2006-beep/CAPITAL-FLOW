const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// ── Connection ─────────────────────────────────────────────────────────────
// If TURSO_DB_URL is set, connect to Turso cloud (production / Koyeb).
// Otherwise fall back to a local file (dev) or in-memory (tests via
// TURSO_DB_URL=file::memory:  set by testEnv.js).
function makeUrl() {
  if (process.env.TURSO_DB_URL) return process.env.TURSO_DB_URL;
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return 'file:' + path.join(dataDir, 'users.db');
}

const client = createClient({
  url: makeUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// ── Async wrapper API ──────────────────────────────────────────────────────
// Mimics better-sqlite3's prepare().get/all/run interface but returns
// Promises, so every call site uses `await db.prepare(sql).get(...)` etc.
//
// @libsql/client.execute({ sql, args }) returns:
//   { rows, rowsAffected, lastInsertRowid }
// rows[N] supports named-column access (row.colName).
// lastInsertRowid is BigInt — we convert to Number.

function prepare(sql) {
  return {
    async get(...args) {
      const result = await client.execute({ sql, args });
      return result.rows.length > 0 ? toPlainObject(result.rows[0]) : undefined;
    },
    async all(...args) {
      const result = await client.execute({ sql, args });
      return result.rows.map(toPlainObject);
    },
    async run(...args) {
      const result = await client.execute({ sql, args });
      return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid != null ? Number(result.lastInsertRowid) : undefined,
      };
    },
  };
}

// Convert a libsql Row (Proxy object with named + indexed access) to a plain JS object.
function toPlainObject(row) {
  const obj = {};
  // row[Symbol.iterator] or Object.keys may not enumerate named keys on all
  // versions; the safest approach is to spread using the row's own enumerable
  // string keys provided by the libsql driver.
  for (const key of Object.keys(row)) {
    obj[key] = row[key];
  }
  return obj;
}

// exec splits on ';', runs each non-empty statement individually (libsql
// does not support multi-statement strings the way better-sqlite3 does).
async function exec(sql) {
  const stmts = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of stmts) {
    await client.execute(s);
  }
}

const db = { prepare, exec };

// ── Schema migrations (run at startup) ────────────────────────────────────
async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT    UNIQUE NOT NULL,
      password_hash   TEXT,
      google_id       TEXT    UNIQUE,
      google_email    TEXT,
      is_verified     INTEGER NOT NULL DEFAULT 0,
      is_premium      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    NOT NULL,
      code        TEXT    NOT NULL,
      type        TEXT    NOT NULL CHECK(type IN ('verify_email','reset_password')),
      expires_at  INTEGER NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, type);

    CREATE TABLE IF NOT EXISTS watchlist_alerts (
      user_id    INTEGER NOT NULL,
      symbol     TEXT    NOT NULL,
      min_ratio  REAL    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, symbol)
    );

    CREATE INDEX IF NOT EXISTS idx_wl_alerts_user ON watchlist_alerts(user_id);

    CREATE TABLE IF NOT EXISTS pilot_allowlist (
      email      TEXT    PRIMARY KEY,
      added_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      endpoint   TEXT    NOT NULL UNIQUE,
      p256dh     TEXT    NOT NULL,
      auth       TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      email      TEXT,
      message    TEXT    NOT NULL,
      page       TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

    CREATE TABLE IF NOT EXISTS coupons (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      code             TEXT    NOT NULL UNIQUE,
      discount_percent INTEGER NOT NULL CHECK(discount_percent BETWEEN 1 AND 100),
      applies_to       TEXT    NOT NULL DEFAULT 'both' CHECK(applies_to IN ('both','premium','elite')),
      active           INTEGER NOT NULL DEFAULT 1,
      max_uses         INTEGER,
      uses_count       INTEGER NOT NULL DEFAULT 0,
      expires_at       INTEGER,
      paddle_discount_id TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scheduled_scans (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      scan_type         TEXT    NOT NULL CHECK(scan_type IN ('capitalFlow','maScanner','sectorMoving')),
      scan_time         TEXT    NOT NULL,
      active            INTEGER NOT NULL DEFAULT 1,
      last_run_at       INTEGER,
      last_result_count INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_scans_user ON scheduled_scans(user_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_scans_time ON scheduled_scans(scan_time, active);

    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      event_id     TEXT    PRIMARY KEY,
      processed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      actor          TEXT    NOT NULL,
      action         TEXT    NOT NULL,
      target_user_id INTEGER,
      detail         TEXT,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at)
  `);

  // Safe migrations — silently ignored if the column already exists
  const migrations = [
    `ALTER TABLE users ADD COLUMN ma_scan_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN is_blocked    INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN is_pilot      INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN pilot_terms_accepted_at INTEGER`,
    `ALTER TABLE users ADD COLUMN notification_time TEXT`,
    `ALTER TABLE users ADD COLUMN free_scan_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN free_scan_used_capital_flow INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN free_scan_used_ma_scanner INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN free_scan_used_sector_moving INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN premium_scan_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN premium_scan_window_start INTEGER`,
    `ALTER TABLE users ADD COLUMN last_login_at INTEGER`,
    `ALTER TABLE coupons ADD COLUMN paddle_discount_id TEXT`,
  ];

  for (const sql of migrations) {
    try {
      await client.execute(sql);
    } catch (_) {
      // Column already exists — expected on every run after the first
    }
  }

  // notification_time is added via ALTER TABLE above, after the table's own
  // CREATE INDEX block already ran — indexed separately here. Every tick of
  // the scheduled digest (server/services/scheduledDigest.js) does
  // `WHERE notification_time = ?` against the full users table; without an
  // index that's a full table scan on every single minute, growing worse as
  // the user base grows.
  await client.execute('CREATE INDEX IF NOT EXISTS idx_users_notification_time ON users(notification_time)');

  // One-time data migration: carry over ma_scan_count → free_scan_count
  try {
    await client.execute(`UPDATE users SET free_scan_count = ma_scan_count WHERE ma_scan_count > 0 AND free_scan_count = 0`);
  } catch (_) {}

  // One-time data migration: set tier from is_premium
  try {
    await client.execute(`UPDATE users SET tier = 'premium' WHERE is_premium = 1 AND tier = 'free'`);
  } catch (_) {}

  // OTP pruning — once at startup, then daily
  async function pruneExpiredOtps() {
    const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    try {
      await db.prepare('DELETE FROM otp_codes WHERE used = 1 OR expires_at < ?').run(cutoff);
    } catch (_) {}
  }
  await pruneExpiredOtps();
  setInterval(() => pruneExpiredOtps(), 24 * 60 * 60 * 1000).unref();
}

// Kick off schema init. All db consumers must await db.ready before their
// first query — but since this only takes a few ms on startup and every
// consumer is in an async context (route handlers, service functions) the
// natural startup order is fine in practice.
const ready = initDb().catch((err) => {
  console.error('[db] Fatal: schema init failed:', err);
  process.exit(1);
});

db.ready = ready;

module.exports = db;
