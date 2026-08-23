// Regression coverage for one-time OTP consumption and bcrypt's 72-byte
// input boundary. These tests use the isolated in-memory test database and
// never send a real email.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
const authRouter = require('../server/routes/auth');
const { saveOTP, verifyOTP } = require('../server/services/auth');

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
