const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Allow overriding the DB location (e.g. ':memory:' or a temp file) so the
// test suite never touches real user data.
const dbPath =
  process.env.DB_PATH ||
  (() => {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, 'users.db');
  })();

const db = new Database(dbPath);

// WAL mode: survives server crashes mid-write, much safer than default rollback journal
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
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

  -- Emails pre-approved for the pilot program. A signup with a matching
  -- email is automatically tagged is_pilot=1; managed from the admin panel.
  CREATE TABLE IF NOT EXISTS pilot_allowlist (
    email      TEXT    PRIMARY KEY,
    added_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Web Push subscriptions, one row per browser/device a user has enabled
  -- notifications on. Endpoint is unique per subscription across all users.
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    endpoint   TEXT    NOT NULL UNIQUE,
    p256dh     TEXT    NOT NULL,
    auth       TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);

  -- In-app feedback submissions (floating feedback button). user_id is
  -- nullable — signed-out visitors can still send feedback.
  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    email      TEXT,
    message    TEXT    NOT NULL,
    page       TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
`);

// Safe migrations — no-op if the column already exists
try {
  db.exec(`ALTER TABLE users ADD COLUMN ma_scan_count INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_blocked    INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_pilot      INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN pilot_terms_accepted_at INTEGER`);
} catch (_) {}
// "HH:MM" in Israel local time — when set, the scheduled digest sends a push
// notification at that time every day; null means the digest is disabled.
try {
  db.exec(`ALTER TABLE users ADD COLUMN notification_time TEXT`);
} catch (_) {}

// free_scan_count replaces ma_scan_count as a single pool shared across every
// scan type (Capital Flow, Sector Moving, MA Scanner) — a free user gets 3
// scans total, spendable however they like, not 3 per feature. Existing
// ma_scan_count usage is carried over once so nobody's quota resets for free.
try {
  db.exec(`ALTER TABLE users ADD COLUMN free_scan_count INTEGER NOT NULL DEFAULT 0`);
  db.exec(`UPDATE users SET free_scan_count = ma_scan_count WHERE ma_scan_count > 0`);
} catch (_) {}

// ── 3-tier subscription system (Free / Premium / Elite) ────────────────────
// tier is the new source of truth for what a user can access. is_premium is
// kept in sync (tier !== 'free') so every pre-existing "is this a paying
// user" check elsewhere in the codebase keeps working unchanged.
try {
  db.exec(`ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`);
  db.exec(`UPDATE users SET tier = 'premium' WHERE is_premium = 1`);
} catch (_) {}
// Free tier: one lifetime trial scan per category — independent flags, not a
// shared pool, so using Capital Flow's trial doesn't burn MA Scanner's.
try {
  db.exec(`ALTER TABLE users ADD COLUMN free_scan_used_capital_flow INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN free_scan_used_ma_scanner INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN free_scan_used_sector_moving INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
// Premium tier: a shared pool of scans that resets every 24h (rolling window
// from premium_scan_window_start), rather than Free's one-time trial or
// Elite's no limit at all.
try {
  db.exec(`ALTER TABLE users ADD COLUMN premium_scan_count INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN premium_scan_window_start INTEGER`);
} catch (_) {}

// otp_codes has no natural cap — used and expired rows would otherwise
// accumulate forever. Sweep anything used or expired for more than a day,
// once at startup and then daily.
function pruneExpiredOtps() {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  db.prepare('DELETE FROM otp_codes WHERE used = 1 OR expires_at < ?').run(cutoff);
}
pruneExpiredOtps();
setInterval(pruneExpiredOtps, 24 * 60 * 60 * 1000).unref();

module.exports = db;
