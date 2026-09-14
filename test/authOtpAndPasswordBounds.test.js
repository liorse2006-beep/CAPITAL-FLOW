// Regression coverage for one-time OTP consumption and bcrypt's 72-byte
// input boundary. These tests use the isolated in-memory test database and
// never send a real email.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
const authRouter = require('../server/routes/auth');
const {
  saveOTP,
  verifyOTP,
  hashPassword,
  recordLoginFailure,
  getLoginThrottleState,
  clearLoginFailures,
} = require('../server/services/auth');

before(async () => {
  await db.ready;
});

function startAuthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('the same OTP can verify at most once under concurrent requests', async () => {
  const email = 'otp-race@test.local';
  await saveOTP(email, '123456', 'verify_email');
  const results = await Promise.all([
    verifyOTP(email, '123456', 'verify_email'),
    verifyOTP(email, '123456', 'verify_email'),
  ]);
  assert.strictEqual(results.filter((result) => result.valid).length, 1);
  const row = await db.prepare('SELECT used FROM otp_codes WHERE email = ? AND type = ?').get(email, 'verify_email');
  assert.strictEqual(row.used, 1);
});

test('OTP challenge locks after repeated invalid codes and rejects the correct code until a new challenge', async () => {
  const email = 'otp-lockout@test.local';
  await saveOTP(email, '123456', 'verify_email');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await verifyOTP(email, '000000', 'verify_email');
    assert.strictEqual(result.valid, false);
  }
  const locked = await verifyOTP(email, '123456', 'verify_email');
  assert.strictEqual(locked.valid, false);
  assert.strictEqual(locked.locked, true);
  assert.match(locked.reason, /Too many code attempts/i);
  const row = await db.prepare('SELECT failed_attempts, locked_until FROM otp_codes WHERE email = ?').get(email);
  assert.strictEqual(row.failed_attempts, 5);
  assert.ok(Number(row.locked_until) > Math.floor(Date.now() / 1000));
});

test('known-account login failures remain throttled across requests and clear after a successful credential proof', async () => {
  const email = 'login-lockout@test.local';
  const user = await db
    .prepare('INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 1)')
    .run(email, await hashPassword('correct-password-123'));
  for (let attempt = 0; attempt < 10; attempt += 1) await recordLoginFailure(user.lastInsertRowid);
  const locked = await getLoginThrottleState(user.lastInsertRowid);
  assert.strictEqual(locked.locked, true);
  await clearLoginFailures(user.lastInsertRowid);
  const cleared = await getLoginThrottleState(user.lastInsertRowid);
  assert.strictEqual(cleared.locked, false);
  assert.strictEqual(cleared.failedCount, 0);
});

test('signup rejects passwords longer than bcrypts effective UTF-8 boundary', async () => {
  const server = startAuthApp();
  const appServer = await server;
  try {
    const res = await fetch(`http://127.0.0.1:${appServer.address().port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'long-password@test.local', password: 'a'.repeat(73) }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /72/);
  } finally {
    appServer.close();
  }
});

test('login rejects non-string and oversized passwords without throwing', async () => {
  const server = await startAuthApp();
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    const nonString = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.local', password: { value: 'secret' } }),
    });
    assert.strictEqual(nonString.status, 400);

    const oversized = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.local', password: 'a'.repeat(73) }),
    });
    assert.strictEqual(oversized.status, 401);
  } finally {
    server.close();
  }
});
