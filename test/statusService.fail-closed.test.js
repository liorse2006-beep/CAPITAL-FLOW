const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

function tryBoot(env) {
  try {
    execFileSync(process.execPath, ['-e', "require('./status-service')"], {
      cwd: require('node:path').join(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    return { exitCode: 0 };
  } catch (error) {
    return { exitCode: error.status, stderr: String(error.stderr) };
  }
}

const BASE = {
  NODE_ENV: 'production',
  STATUS_TURSO_DB_URL: 'libsql://independent-status.example',
  STATUS_TURSO_AUTH_TOKEN: 'status-db-token',
  STATUS_INTERNAL_TOKEN: 'status-probe-test-token-which-is-long-enough',
  JWT_SECRET: 'a'.repeat(48),
  SESSION_SECRET: 'b'.repeat(48),
  RESEND_API_KEY: 'test-resend-key',
};

test('independent status service refuses to boot without its own database URL', () => {
  const result = tryBoot({ ...BASE, STATUS_TURSO_DB_URL: '' });
  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /STATUS_TURSO_DB_URL/);
});

test('independent status service refuses to boot without its own database token', () => {
  const result = tryBoot({ ...BASE, STATUS_TURSO_AUTH_TOKEN: '' });
  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /STATUS_TURSO_AUTH_TOKEN/);
});
