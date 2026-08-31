const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const { safeErrorSummary } = require('../utils/reportError');

// ── Connection ─────────────────────────────────────────────────────────────
// If TURSO_DB_URL is set, connect to Turso cloud (production / Render).
// Otherwise fall back to a local file (dev) or in-memory (tests via
// TURSO_DB_URL=file::memory:  set by testEnv.js).
function makeUrl() {
  if (process.env.TURSO_DB_URL) return process.env.TURSO_DB_URL;
  const dataDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return 'file:' + path.join(dataDir, 'users.db');
}

const databaseUrl = makeUrl();
const client = createClient({
  url: databaseUrl,
  // Local/file-backed SQLite does not use a Turso token. Keeping the token
  // out of this client also prevents a stale production secret from being
  // treated as a credential for a local status database.
  authToken: /^file:/i.test(databaseUrl) ? undefined : process.env.TURSO_AUTH_TOKEN || undefined,
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

// Execute a set of parameterized statements atomically.  This is deliberately
// a small wrapper around libSQL's write transaction mode so routes that touch
// multiple user-owned tables cannot leave a partial state after a transient
// database failure.
async function transaction(statements) {
  if (!Array.isArray(statements) || statements.length === 0) return [];
  return client.batch(
    statements.map((statement) => ({ sql: statement.sql, args: statement.args || [] })),
    'write'
  );
}

const db = { prepare, exec, transaction };

// ── Schema migrations (run at startup) ────────────────────────────────────
async function initDb() {
  // Multiple local cluster workers can initialize the same SQLite file at
  // once. Wait on the file lock instead of failing the worker immediately;
  // Turso production connections do not need this, but it makes the local
  // file-mode cluster path behave like the shared production database.
  if (databaseUrl.startsWith('file:')) {
    await client.execute('PRAGMA busy_timeout = 5000');
  }
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
    -- type/target_price/starting_side are added via ALTER TABLE migrations
    -- below (this table predates price alerts) — see there for how a price
    -- alert's crossing direction is tracked.

    CREATE INDEX IF NOT EXISTS idx_wl_alerts_user ON watchlist_alerts(user_id);

    -- Which tickers a user has starred — separate from watchlist_alerts
    -- (that table is the ratio threshold for notifications, this one is
    -- just "which symbols show up on my Watchlist page"). Server-backed so
    -- it follows the account across devices, not just the browser that set it.
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id    INTEGER NOT NULL,
      symbol     TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, symbol)
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

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

    -- Capital Flow Radar recipes are durable, per-user monitoring rules. The
    -- worker evaluates them against the shared market scan and never needs a
    -- browser tab or a user-specific provider request to remain active.
    CREATE TABLE IF NOT EXISTS capital_flow_radars (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      name                TEXT    NOT NULL,
      mode                TEXT    NOT NULL CHECK(mode IN ('all','sp500','nasdaq100','sectors')),
      selected_sectors_json TEXT NOT NULL DEFAULT '[]',
      min_volume_ratio    REAL    NOT NULL,
      min_market_cap      REAL    NOT NULL,
      min_volume          REAL    NOT NULL DEFAULT 0,
      min_price           REAL    NOT NULL DEFAULT 0,
      max_price           REAL    NOT NULL DEFAULT 0,
      ma_period           INTEGER NOT NULL DEFAULT 20,
      ma_distance         REAL    NOT NULL DEFAULT 2,
      ma_interval         TEXT    NOT NULL DEFAULT '1d',
      ma_direction        TEXT    NOT NULL DEFAULT 'all',
      condition_mode      TEXT    NOT NULL DEFAULT 'both' CHECK(condition_mode IN ('both','either')),
      condition_version   TEXT    NOT NULL DEFAULT 'radar-v2',
      schedule_time_1     TEXT,
      schedule_time_2     TEXT,
      expires_on          TEXT,
      active              INTEGER NOT NULL DEFAULT 1,
      last_check_at       TEXT,
      last_success_at     TEXT,
      last_error          TEXT,
      last_error_detail   TEXT,
      last_data_status    TEXT    NOT NULL DEFAULT 'waiting',
      last_data_as_of     TEXT,
      last_scan_run_id    TEXT,
      last_partial_count  INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_capital_flow_radars_user ON capital_flow_radars(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_capital_flow_radars_active ON capital_flow_radars(active, updated_at);

    -- One state row per Radar/symbol. missed_checks prevents an intermittent
    -- quote gap from immediately re-arming a signal.
    CREATE TABLE IF NOT EXISTS radar_states (
      radar_id      INTEGER NOT NULL,
      symbol        TEXT    NOT NULL,
      matches       INTEGER NOT NULL DEFAULT 0,
      entered_at    TEXT,
      last_seen_at  TEXT,
      missed_checks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (radar_id, symbol)
    );

    CREATE INDEX IF NOT EXISTS idx_radar_states_radar ON radar_states(radar_id, matches);

    -- The unique key makes event creation idempotent for a scan cycle. The
    -- payload contains only the validated, non-secret market fields needed
    -- to explain the alert later and no raw provider response is stored.
    CREATE TABLE IF NOT EXISTS radar_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      radar_id            INTEGER NOT NULL,
      user_id             INTEGER NOT NULL,
      symbol              TEXT    NOT NULL,
      scan_time           TEXT    NOT NULL,
      payload_json        TEXT    NOT NULL,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      notified_at         INTEGER,
      notification_error  TEXT,
      UNIQUE (radar_id, symbol, scan_time)
    );

    CREATE INDEX IF NOT EXISTS idx_radar_events_user ON radar_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_radar_events_radar ON radar_events(radar_id, created_at);

    -- Each selected daily slot is claimed once per Jerusalem calendar date.
    -- This prevents the one-minute scheduler from running the same Radar
    -- twice inside the delivery window, including after a process restart.
    CREATE TABLE IF NOT EXISTS radar_schedule_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      radar_id        INTEGER NOT NULL,
      run_date        TEXT    NOT NULL,
      scheduled_time  TEXT    NOT NULL,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER,
      status          TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
      result_count    INTEGER,
      error_code      TEXT,
      error_json      TEXT,
      attempts        INTEGER NOT NULL DEFAULT 1,
      lease_until     INTEGER,
      scan_id         TEXT,
      data_status     TEXT,
      data_as_of      TEXT,
      capital_flow_count INTEGER,
      ma_count        INTEGER,
      UNIQUE (radar_id, run_date, scheduled_time)
    );

    CREATE INDEX IF NOT EXISTS idx_radar_schedule_runs_due ON radar_schedule_runs(run_date, status, scheduled_time);
    CREATE INDEX IF NOT EXISTS idx_radar_schedule_runs_radar ON radar_schedule_runs(radar_id, run_date);

    -- Immutable-ish run metadata makes every notification explainable without
    -- storing provider secrets or an unbounded copy of every market row.
    -- The payload records the exact condition version and source timestamps.
    -- raw provider responses remain outside the user-facing database.
    CREATE TABLE IF NOT EXISTS radar_run_snapshots (
      scan_id             TEXT PRIMARY KEY,
      started_at           TEXT NOT NULL,
      completed_at         TEXT,
      capital_flow_as_of  TEXT,
      ma_as_of            TEXT,
      data_status          TEXT NOT NULL,
      condition_version    TEXT NOT NULL,
      ma_period            INTEGER,
      ma_distance          REAL,
      ma_interval          TEXT,
      ma_direction         TEXT,
      result_count         INTEGER NOT NULL DEFAULT 0,
      checked_count        INTEGER NOT NULL DEFAULT 0,
      error_json           TEXT,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_radar_run_snapshots_created ON radar_run_snapshots(created_at);

    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      event_id     TEXT    PRIMARY KEY,
      processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      claim_token  TEXT,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      actor          TEXT    NOT NULL,
      action         TEXT    NOT NULL,
      target_user_id INTEGER,
      detail         TEXT,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at);

    -- Durable record of every alert/digest push sent to a user, so it still
    -- shows up in the in-app bell even if the push never reached the device
    -- (computer off, notification dismissed without being seen, etc).
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      symbol     TEXT,
      title      TEXT    NOT NULL,
      body       TEXT    NOT NULL,
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

    -- Capi chat history — persisted per account (not just per session) so
    -- a returning user still sees their earlier conversation.
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      role       TEXT    NOT NULL CHECK(role IN ('user','assistant')),
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id, id);

    -- Durable, cross-process provider budget accounting.  Unlike in-memory
    -- counters this survives deploys and is shared by every Render worker.
    CREATE TABLE IF NOT EXISTS ai_usage (
      usage_date  TEXT    NOT NULL,
      scope       TEXT    NOT NULL,
      user_id     INTEGER NOT NULL DEFAULT 0,
      calls       INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      reservation_token TEXT,
      PRIMARY KEY (usage_date, scope, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_usage_retention ON ai_usage(usage_date);

    -- One durable row per Premium scan-slot reservation. The middleware
    -- reserves before the route starts doing provider work, keeping the
    -- reservation id lets a cache-hit/error refund exactly its own slot,
    -- even when several requests for the same account overlap.
    CREATE TABLE IF NOT EXISTS scan_reservations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      window_start  INTEGER NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      refunded_at   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_scan_reservations_user ON scan_reservations(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_scan_reservations_retention ON scan_reservations(created_at);

    -- Small durable key/value store for app-level facts that need to survive
    -- restarts (Render's filesystem doesn't) but don't warrant their own
    -- table — e.g. the last successful DB backup timestamp.
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Lightweight daily site-visit counter — one row per calendar day (UTC),
    -- incremented once per browser session (see POST /api/visit). Aggregated,
    -- not per-request, so it never grows without bound the way a raw pageview
    -- log would. Surfaced in the admin panel ("Visits today / this week").
    CREATE TABLE IF NOT EXISTS site_visits (
      day   TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    );

    -- One row per logged-in device. Replaces the old single global
    -- session_version column (which allowed exactly one active login per
    -- account, site-wide, and silently booted every other device the moment
    -- any device logged in again). A short-lived JWT access token embeds
    -- this row's id (sid) - the actual long-lived credential is the
    -- refresh_token_hash here, handed to the browser as an httpOnly cookie
    -- so a closed app / cold reload can silently mint a new access token
    -- without the user ever seeing a login screen. Capped at
    -- MAX_ACTIVE_SESSIONS (see services/auth.js) — logging in on one device
    -- too many evicts only the least-recently-used session, not everyone.
    CREATE TABLE IF NOT EXISTS user_sessions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      refresh_token_hash  TEXT    NOT NULL UNIQUE,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, last_used_at);

    -- Public status page and monitoring history. These tables intentionally
    -- live beside the application data so the status APIs can be added without
    -- changing any user-facing schema. Raw diagnostics stay private in
    -- status_checks, while the public route only exposes sanitized aggregates.
    CREATE TABLE IF NOT EXISTS status_components (
      component_key       TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      description         TEXT NOT NULL,
      group_name          TEXT NOT NULL,
      criticality         TEXT NOT NULL,
      check_type          TEXT NOT NULL,
      endpoint            TEXT,
      expected_status     INTEGER,
      timeout_ms          INTEGER NOT NULL DEFAULT 8000,
      slow_ms             INTEGER NOT NULL DEFAULT 1500,
      very_slow_ms        INTEGER NOT NULL DEFAULT 4000,
      enabled             INTEGER NOT NULL DEFAULT 1,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS status_checks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_id            TEXT NOT NULL,
      component_key       TEXT NOT NULL,
      checked_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      attempt             INTEGER NOT NULL DEFAULT 1,
      endpoint            TEXT,
      check_type          TEXT NOT NULL,
      success             INTEGER NOT NULL DEFAULT 0,
      state               TEXT NOT NULL DEFAULT 'unknown',
      status_code         INTEGER,
      response_ms         INTEGER,
      error_message       TEXT,
      timed_out           INTEGER NOT NULL DEFAULT 0,
      final_result        INTEGER NOT NULL DEFAULT 1,
      incident_id         INTEGER,
      metadata_json       TEXT,
      FOREIGN KEY (component_key) REFERENCES status_components(component_key)
    );

    CREATE INDEX IF NOT EXISTS idx_status_checks_component_time ON status_checks(component_key, checked_at);
    CREATE INDEX IF NOT EXISTS idx_status_checks_incident ON status_checks(incident_id);

    CREATE TABLE IF NOT EXISTS status_incidents (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id           TEXT NOT NULL UNIQUE,
      component_key       TEXT NOT NULL,
      title               TEXT NOT NULL,
      severity            TEXT NOT NULL,
      status              TEXT NOT NULL,
      started_at          INTEGER NOT NULL,
      identified_at       INTEGER,
      monitoring_at       INTEGER,
      resolved_at         INTEGER,
      outage_seconds      INTEGER,
      failure_count       INTEGER NOT NULL DEFAULT 0,
      recovery_count      INTEGER NOT NULL DEFAULT 0,
      error_message       TEXT,
      public_summary      TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_status_incidents_status_time ON status_incidents(status, started_at);
    CREATE INDEX IF NOT EXISTS idx_status_incidents_component ON status_incidents(component_key, status);

    CREATE TABLE IF NOT EXISTS status_incident_updates (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id         INTEGER NOT NULL,
      status              TEXT NOT NULL,
      message             TEXT NOT NULL,
      is_public           INTEGER NOT NULL DEFAULT 1,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (incident_id) REFERENCES status_incidents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_status_incident_updates_incident ON status_incident_updates(incident_id, created_at);

    CREATE TABLE IF NOT EXISTS status_notification_deliveries (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id         INTEGER NOT NULL,
      notification_type   TEXT NOT NULL,
      recipient           TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      attempts            INTEGER NOT NULL DEFAULT 0,
      sent_at             INTEGER,
      last_error          TEXT,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (incident_id) REFERENCES status_incidents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_status_notifications_incident ON status_notification_deliveries(incident_id, notification_type);

    CREATE TABLE IF NOT EXISTS status_alert_recipients (
      email               TEXT PRIMARY KEY,
      active              INTEGER NOT NULL DEFAULT 1,
      source              TEXT NOT NULL DEFAULT 'environment',
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS status_maintenance (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL,
      starts_at           INTEGER NOT NULL,
      ends_at             INTEGER NOT NULL,
      affected_components TEXT NOT NULL,
      created_by          TEXT NOT NULL,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_status_maintenance_window ON status_maintenance(starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS status_meta (
      key                 TEXT PRIMARY KEY,
      value               TEXT NOT NULL,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Durable daily rollups keep long-term availability history after raw
    -- checks are pruned. The row is replaced from the still-present raw day
    -- before deletion, making a retry idempotent if a worker stops mid-prune.
    CREATE TABLE IF NOT EXISTS status_daily_rollups (
      day                 TEXT NOT NULL,
      component_key       TEXT NOT NULL,
      total_checks        INTEGER NOT NULL,
      successful_checks   INTEGER NOT NULL,
      degraded_checks     INTEGER NOT NULL DEFAULT 0,
      failed_checks       INTEGER NOT NULL,
      first_check         INTEGER,
      last_check          INTEGER,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (day, component_key)
    );

    CREATE INDEX IF NOT EXISTS idx_status_rollups_day ON status_daily_rollups(day);

    -- A short-lived lease prevents two independently deployed status hosts
    -- from running the same monitoring cycle and sending duplicate incidents.
    -- The lease is advisory and expires automatically if a worker dies.
    CREATE TABLE IF NOT EXISTS status_worker_leases (
      lock_key            TEXT PRIMARY KEY,
      owner_id            TEXT NOT NULL,
      expires_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Keep the component catalog durable while allowing the monitor to add new
  // checks in a later deploy without rewriting existing operator settings.
  try {
    const { getComponentDefinitions } = require('../services/statusConfig');
    for (const component of getComponentDefinitions()) {
      await db
        .prepare(
          `INSERT INTO status_components
             (component_key, name, description, group_name, criticality, check_type, endpoint,
              expected_status, timeout_ms, slow_ms, very_slow_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(component_key) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             group_name = excluded.group_name,
             criticality = excluded.criticality,
             check_type = excluded.check_type,
             endpoint = excluded.endpoint,
             expected_status = excluded.expected_status,
             timeout_ms = excluded.timeout_ms,
             slow_ms = excluded.slow_ms,
             very_slow_ms = excluded.very_slow_ms,
             updated_at = unixepoch()`
        )
        .run(
          component.key,
          component.name,
          component.description,
          component.group,
          component.criticality,
          component.type,
          component.path || null,
          component.expectedStatus || null,
          component.timeoutMs,
          component.slowMs,
          component.verySlowMs
        );
    }
  } catch (err) {
    console.warn('[db] Status component seed skipped:', safeErrorSummary(err));
  }

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
    `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
    `ALTER TABLE coupons ADD COLUMN paddle_discount_id TEXT`,
    // Chains multi-turn Capi conversations server-side on Gemini's end —
    // see services/chatbot.js. Null just means "start a fresh conversation".
    `ALTER TABLE users ADD COLUMN gemini_interaction_id TEXT`,
    // Lets a scheduled-scan notification carry its own scan's actual results,
    // so tapping the push notification can show exactly what that run found
    // instead of dropping the user on an empty/unrelated page. Null for every
    // other notification kind (watchlist alerts, etc).
    `ALTER TABLE notifications ADD COLUMN scan_type TEXT`,
    `ALTER TABLE notifications ADD COLUMN results_json TEXT`,
    // NULL = recurring daily at scan_time (the original behavior). A real
    // 'YYYY-MM-DD' date makes the schedule fire exactly once on that date —
    // the runner deactivates it right after, so the customer explicitly
    // chooses "every day" instead of that being the only option.
    `ALTER TABLE scheduled_scans ADD COLUMN scan_date TEXT`,
    // Price alerts, alongside the original volume-ratio alerts. type
    // discriminates the row ('volume' | 'price'); min_ratio stays 0/unused
    // for a price row. starting_side ('above'|'below') is which side of
    // target_price the symbol was on when the alert was created — the
    // background checker fires once the live price lands on the opposite
    // side, i.e. the moment it actually crosses target_price, not just
    // whenever it happens to already be past it.
    `ALTER TABLE watchlist_alerts ADD COLUMN type TEXT NOT NULL DEFAULT 'volume'`,
    `ALTER TABLE watchlist_alerts ADD COLUMN target_price REAL`,
    `ALTER TABLE watchlist_alerts ADD COLUMN starting_side TEXT`,
    // Distinguishes "claimed this webhook event" from "actually finished
    // handling it" — without this, a deploy that kills the process between
    // the claim and the business logic completing leaves a permanently
    // stuck claim: Whop's retry of the same event sees the row already
    // exists and gives up, silently dropping a paid upgrade forever. See
    // routes/webhooks.js.
    `ALTER TABLE processed_webhook_events ADD COLUMN completed_at INTEGER`,
    // A random owner token lets completion and failure cleanup affect only
    // the request that currently owns the event. processed_at is the
    // lease-start timestamp used to recover a claim abandoned by a crashed
    // process after the retry window has elapsed.
    `ALTER TABLE processed_webhook_events ADD COLUMN claim_token TEXT`,
    `ALTER TABLE status_checks ADD COLUMN cycle_id TEXT`,
    `ALTER TABLE status_checks ADD COLUMN final_result INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE capital_flow_radars ADD COLUMN schedule_time_1 TEXT`,
    `ALTER TABLE capital_flow_radars ADD COLUMN schedule_time_2 TEXT`,
    `ALTER TABLE capital_flow_radars ADD COLUMN expires_on TEXT`,
    `ALTER TABLE capital_flow_radars ADD COLUMN ma_period INTEGER NOT NULL DEFAULT 20`,
    `ALTER TABLE capital_flow_radars ADD COLUMN ma_distance REAL NOT NULL DEFAULT 2`,
    `ALTER TABLE capital_flow_radars ADD COLUMN ma_interval TEXT NOT NULL DEFAULT '1d'`,
    `ALTER TABLE capital_flow_radars ADD COLUMN ma_direction TEXT NOT NULL DEFAULT 'all'`,
    `ALTER TABLE capital_flow_radars ADD COLUMN condition_mode TEXT NOT NULL DEFAULT 'both'`,
    `ALTER TABLE capital_flow_radars ADD COLUMN condition_version TEXT NOT NULL DEFAULT 'radar-v2'`,
    `ALTER TABLE capital_flow_radars ADD COLUMN last_error_detail TEXT`,
    `ALTER TABLE capital_flow_radars ADD COLUMN last_data_status TEXT NOT NULL DEFAULT 'waiting'`,
    `ALTER TABLE capital_flow_radars ADD COLUMN last_data_as_of TEXT`,
    `ALTER TABLE capital_flow_radars ADD COLUMN last_scan_run_id TEXT`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN error_json TEXT`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN lease_until INTEGER`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN scan_id TEXT`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN data_status TEXT`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN data_as_of TEXT`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN capital_flow_count INTEGER`,
    `ALTER TABLE radar_schedule_runs ADD COLUMN ma_count INTEGER`,
    `ALTER TABLE ai_usage ADD COLUMN reservation_token TEXT`,
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
  await client.execute('CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id, id)');
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_radar_schedule_runs_lease ON radar_schedule_runs(status, lease_until)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_capital_flow_radars_data_status ON capital_flow_radars(last_data_status, active)'
  );

  // Existing deployments may have been created before the one-live-Radar
  // invariant existed. Preserve every recipe and its history, but pause older
  // duplicate active recipes deterministically before creating the unique
  // index. This is idempotent and changes no rows when the invariant already
  // holds.
  try {
    await client.execute(
      `UPDATE capital_flow_radars
          SET active = 0, updated_at = unixepoch()
        WHERE active = 1
          AND id NOT IN (
            SELECT MAX(id)
              FROM capital_flow_radars
             WHERE active = 1
             GROUP BY user_id
          )`
    );
    await client.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_capital_flow_radars_one_active_user
         ON capital_flow_radars(user_id)
         WHERE active = 1`
    );
  } catch (err) {
    // This index is the database-level guarantee behind the product rule that
    // a user can have only one active Radar. Serving traffic without it would
    // turn a transient DDL/provider failure into a silent quota bypass. Let
    // initDbWithRetry handle transient SQLite locks; every other failure must
    // fail readiness and stop the process before routes can accept writes.
    console.error('[db] Radar single-active invariant setup failed:', safeErrorSummary(err));
    throw err;
  }

  // One-time data migration: carry over ma_scan_count → free_scan_count
  try {
    await client.execute(
      `UPDATE users SET free_scan_count = ma_scan_count WHERE ma_scan_count > 0 AND free_scan_count = 0`
    );
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

  // A device that never comes back (old phone, browser reinstall) leaves an
  // inert row behind forever otherwise — 180 days is well past even a very
  // infrequent user's normal gap between visits.
  async function pruneStaleSessions() {
    const cutoff = Math.floor(Date.now() / 1000) - 180 * 24 * 60 * 60;
    try {
      await db.prepare('DELETE FROM user_sessions WHERE last_used_at < ?').run(cutoff);
    } catch (_) {}
  }
  await pruneStaleSessions();
  setInterval(() => pruneStaleSessions(), 24 * 60 * 60 * 1000).unref();

  // Radar state is current-state data, but run metadata and entry history
  // must not grow forever. Keep a useful long-term window by default while
  // allowing the operator to tune it without changing application code.
  const configuredRadarRetention = Number(process.env.RADAR_HISTORY_RETENTION_DAYS);
  const radarRetentionDays =
    Number.isInteger(configuredRadarRetention) && configuredRadarRetention >= 30 && configuredRadarRetention <= 3650
      ? configuredRadarRetention
      : 365;
  function radarRetentionDate() {
    const cutoff = new Date(Date.now() - radarRetentionDays * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(cutoff);
    const map = {};
    parts.forEach((part) => {
      map[part.type] = part.value;
    });
    return `${map.year}-${map.month}-${map.day}`;
  }
  async function pruneRadarHistory() {
    const cutoffSeconds = Math.floor(Date.now() / 1000) - radarRetentionDays * 24 * 60 * 60;
    const cutoffDate = radarRetentionDate();
    try {
      await db.prepare('DELETE FROM radar_run_snapshots WHERE created_at < ?').run(cutoffSeconds);
      await db.prepare('DELETE FROM radar_events WHERE created_at < ?').run(cutoffSeconds);
      await db
        .prepare(
          `DELETE FROM radar_schedule_runs
             WHERE run_date < ?
               AND (status <> 'pending' OR started_at < ?)`
        )
        .run(cutoffDate, cutoffSeconds);
    } catch (err) {
      console.warn('[db] Radar history pruning skipped:', safeErrorSummary(err));
    }
  }
  await pruneRadarHistory();
  setInterval(() => pruneRadarHistory(), 24 * 60 * 60 * 1000).unref();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SQLITE_BUSY/SQLITE_LOCKED are transient — the schema is identical on every
// boot (every migration is CREATE-IF-NOT-EXISTS/ALTER-IF-MISSING, so running
// it twice is always safe), so retrying past a brief lock is correct, not
// just convenient. This matters most when multiple processes share one
// local SQLite file and boot at the same moment — e.g. `CLUSTER_WORKERS`
// (server.js) starting several workers together, each running this same
// initDb() independently. Real Turso in production is a proper client/
// server database rather than raw file locking, so this path is expected
// to matter mainly for local/file-mode DBs, but retrying costs nothing
// either way.
async function initDbWithRetry(maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await initDb();
    } catch (err) {
      const transient = err && (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED');
      if (!transient || attempt === maxAttempts) throw err;
      await sleep(Math.min(1000, 100 * attempt) + Math.random() * 100);
    }
  }
}

// Kick off schema init. All db consumers must await db.ready before their
// first query — but since this only takes a few ms on startup and every
// consumer is in an async context (route handlers, service functions) the
// natural startup order is fine in practice.
const ready = initDbWithRetry().catch((err) => {
  console.error('[db] Fatal: schema init failed:', safeErrorSummary(err));
  process.exit(1);
});

db.ready = ready;

module.exports = db;
