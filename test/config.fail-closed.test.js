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

test('boots normally with a strong secret', () => {
  const { exitCode } = tryBootWith({ JWT_SECRET: 'a'.repeat(48), SESSION_SECRET: 'b'.repeat(48) });
  assert.strictEqual(exitCode, 0, 'process should boot when secrets are strong');
});
