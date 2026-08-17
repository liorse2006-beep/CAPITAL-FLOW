// Regression test for the admin-impersonation vulnerability fixed on this
// branch: server/config.js used to silently fall back to a public default
// secret when JWT_SECRET / SESSION_SECRET were unset, letting anyone forge
// an admin JWT. It must now refuse to boot instead.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '../server/config.js');

function tryBootWith(env) {
  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(CONFIG_PATH)})`], {
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status, stderr: String(err.stderr) };
  }
}

test('refuses to boot with the known public fallback secret', () => {
  const { exitCode } = tryBootWith({ JWT_SECRET: 'dev-secret-change-in-production', SESSION_SECRET: 'x'.repeat(40) });
  assert.strictEqual(exitCode, 1, 'process should exit(1) on an insecure JWT_SECRET');
});

test('refuses to boot with a missing secret', () => {
  const { exitCode } = tryBootWith({ JWT_SECRET: '', SESSION_SECRET: 'x'.repeat(40) });
  assert.strictEqual(exitCode, 1, 'process should exit(1) when JWT_SECRET is unset');
});

test('refuses to boot with a short/weak secret', () => {
  const { exitCode } = tryBootWith({ JWT_SECRET: 'too-short', SESSION_SECRET: 'x'.repeat(40) });
  assert.strictEqual(exitCode, 1, 'process should exit(1) on a <32-char secret');
});

test('boots normally with strong non-production secrets', () => {
  const { exitCode } = tryBootWith({ JWT_SECRET: 'a'.repeat(48), SESSION_SECRET: 'b'.repeat(48) });
  assert.strictEqual(exitCode, 0, 'process should boot when secrets are strong');
});

// Regression: GOOGLE_CALLBACK_URL silently defaulted to
// http://localhost:3001/... in every environment, including production —
// Google login would complete on Google's side and then redirect the
// user's browser to localhost, a completely broken flow with no error
// anywhere. This must now refuse to boot instead.
const STRONG_SECRETS = {
  JWT_SECRET: 'a'.repeat(48),
  SESSION_SECRET: 'b'.repeat(48),
  STATUS_INTERNAL_TOKEN: 'status-probe-test-token-which-is-long-enough',
};

test('refuses to boot in production without the protected status probe credential', () => {
  const { exitCode, stderr } = tryBootWith({
    JWT_SECRET: 'a'.repeat(48),
    SESSION_SECRET: 'b'.repeat(48),
    NODE_ENV: 'production',
    RESEND_API_KEY: 'test-resend-key',
    STATUS_INTERNAL_TOKEN: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  });
  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /STATUS_INTERNAL_TOKEN/);
});

test('refuses to boot in production with Google OAuth configured but no GOOGLE_CALLBACK_URL', () => {
  const { exitCode, stderr } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'production',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALLBACK_URL: '',
  });
  assert.strictEqual(exitCode, 1, 'process should exit(1) when Google OAuth would silently redirect to localhost');
  assert.match(stderr, /GOOGLE_CALLBACK_URL/);
});

test('boots normally in production when GOOGLE_CALLBACK_URL is explicitly set', () => {
  const { exitCode } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'production',
    RESEND_API_KEY: 'test-resend-key',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALLBACK_URL: 'https://real-domain.example/api/auth/google/callback',
  });
  assert.strictEqual(exitCode, 0);
});

test('boots normally in production when Google OAuth is not configured at all', () => {
  const { exitCode } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'production',
    RESEND_API_KEY: 'test-resend-key',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_CALLBACK_URL: '',
  });
  assert.strictEqual(exitCode, 0, 'no Google OAuth means the missing callback URL is irrelevant');
});

test('does not enforce GOOGLE_CALLBACK_URL outside production (dev may fall back to localhost)', () => {
  const { exitCode } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'development',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALLBACK_URL: '',
  });
  assert.strictEqual(exitCode, 0);
});

// Regression: without RESEND_API_KEY, services/email.js silently falls back
// to console.log-ing OTP and password-reset codes in plaintext instead of
// emailing them — fine in dev, but in production that means every signup
// and password-reset code lands in plaintext server logs. This must now
// refuse to boot instead.
// GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL are cleared in every case below —
// otherwise real Google OAuth credentials sitting in the developer's own
// .env would leak into this subprocess's env (tryBootWith merges
// ...process.env) and trip the unrelated GOOGLE_CALLBACK_URL check instead
// of isolating RESEND_API_KEY as the one thing under test.
test('refuses to boot in production without RESEND_API_KEY', () => {
  const { exitCode, stderr } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'production',
    RESEND_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  });
  assert.strictEqual(exitCode, 1, 'process should exit(1) when RESEND_API_KEY is unset in production');
  assert.match(stderr, /RESEND_API_KEY/);
});

test('boots normally in production when RESEND_API_KEY is set', () => {
  const { exitCode } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'production',
    RESEND_API_KEY: 'test-resend-key',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  });
  assert.strictEqual(exitCode, 0);
});

test('does not enforce RESEND_API_KEY outside production (dev may log OTPs to console)', () => {
  const { exitCode } = tryBootWith({
    ...STRONG_SECRETS,
    NODE_ENV: 'development',
    RESEND_API_KEY: '',
  });
  assert.strictEqual(exitCode, 0);
});
