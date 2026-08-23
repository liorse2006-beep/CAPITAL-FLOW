// Must be required before any server/ module — sets up a safe, isolated
// environment so tests never touch real secrets or the real user database.
process.env.JWT_SECRET = 'test-jwt-secret-'.padEnd(32, 'x');
process.env.SESSION_SECRET = 'test-session-secret-'.padEnd(32, 'x');
// Use libsql in-memory mode — no file on disk, isolated per process.
process.env.TURSO_DB_URL = 'file::memory:';
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
