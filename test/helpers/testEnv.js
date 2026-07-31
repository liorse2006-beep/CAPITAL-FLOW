// Must be required before any server/ module — sets up a safe, isolated
// environment so tests never touch real secrets or the real user database.
process.env.JWT_SECRET = 'test-jwt-secret-'.padEnd(32, 'x');
process.env.SESSION_SECRET = 'test-session-secret-'.padEnd(32, 'x');
// Use libsql in-memory mode — no file on disk, isolated per process.
process.env.TURSO_DB_URL = 'file::memory:';
process.env.ADMIN_EMAIL = 'admin@test.local';
// CAPTCHA runs in "not configured" (bypass) mode by default — otherwise the
// developer's real .env secret leaks in via dotenv and every signup test
// fails for lack of a token. A test that wants enforcement ON sets its own
// value BEFORE requiring this file (dotenv never overrides what's set here).
if (process.env.TURNSTILE_SECRET === undefined) process.env.TURNSTILE_SECRET = '';
if (process.env.HCAPTCHA_SECRET === undefined) process.env.HCAPTCHA_SECRET = '';
