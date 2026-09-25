// Must be required before any server/ module — sets up a safe, isolated
// environment so tests never touch real secrets or the real user database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'test-jwt-secret-'.padEnd(32, 'x');
process.env.SESSION_SECRET = 'test-session-secret-'.padEnd(32, 'x');
// Use a unique temporary SQLite file. The libsql memory URL can isolate
// connections created in separate async/test contexts, making an HTTP route
// see an empty schema even after the test runner initialized it. A per-process
// temp file shares the schema safely and never points at application data.
// DATABASE_URL takes precedence over TURSO_DB_URL in server/db, so it must be
// blank in tests even when a developer has a local or hosted database URL in
// their environment. Otherwise tests can mutate application data.
process.env.DATABASE_URL = '';
// Node's test runner can reuse worker PIDs between sequential test files. A
// random suffix prevents a stale SQLite file from a prior worker/run from
// being mistaken for this process's isolated database.
const testDatabasePath = path.join(os.tmpdir(), `capital-flow-tests-${process.pid}-${crypto.randomUUID()}.db`);
process.env.TURSO_DB_URL = `file:${testDatabasePath}`;
process.env.CAPITAL_FLOW_TEST_DATABASE_URL = process.env.TURSO_DB_URL;
process.once('exit', () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${testDatabasePath}${suffix}`);
    } catch (_) {
      // The operating system removes any locked temp files after the process exits.
    }
  }
});
// dotenv supports DOTENV_CONFIG_OVERRIDE as a process-level switch. Prevent
// it from letting .env replace the isolated database above when test modules
// load server/config.js later.
process.env.DOTENV_CONFIG_OVERRIDE = 'false';
process.env.ADMIN_EMAIL = 'admin@test.local';
// dotenv (loaded when config.js is first required) would otherwise leak the
// developer's real RESEND_API_KEY from .env into every test run — every
// signup/OTP/upgrade-alert test would then make a REAL call to Resend's API
// instead of taking the "not configured" dev-log branch. That was invisible
// as long as send() failures were silently swallowed; now that email.js
// checks Resend's response and throws on a real failure, a live call to a
// Resend-rejected test address (e.g. anything @example.com) surfaces as a
// genuine 500 instead of a silent no-op. Tests must never depend on a live
// third-party API — force it off here, the same way TURNSTILE/HCAPTCHA are
// neutralized below. A test that specifically wants Resend "configured" to
// exercise a mocked send can still set its own value before requiring
// anything (dotenv never overrides a value already present in process.env).
if (process.env.RESEND_API_KEY === undefined) process.env.RESEND_API_KEY = '';
// Market-data provider tests must never call the developer's configured
// Massive key. Tests that explicitly exercise the news provider set their own
// fake key after this helper loads and mock fetch.
if (process.env.MASSIVE_API_KEY === undefined) process.env.MASSIVE_API_KEY = '';
// FMP is optional in production, but tests must never inherit a real provider
// key from the developer's .env and make an outbound request accidentally.
if (process.env.FMP_API_KEY === undefined) process.env.FMP_API_KEY = '';
// CAPTCHA runs in "not configured" (bypass) mode by default — otherwise the
// developer's real .env secret leaks in via dotenv and every signup test
// fails for lack of a token. A test that wants enforcement ON sets its own
// value BEFORE requiring this file (dotenv never overrides what's set here).
if (process.env.TURNSTILE_SECRET === undefined) process.env.TURNSTILE_SECRET = '';
if (process.env.HCAPTCHA_SECRET === undefined) process.env.HCAPTCHA_SECRET = '';
// Status-backup behavior is tested explicitly in statusDbBackup.test.js;
// keep those tests enabled without enabling backup email scheduling in local
// development or production defaults.
if (process.env.STATUS_BACKUP_ENABLED === undefined) process.env.STATUS_BACKUP_ENABLED = 'true';
