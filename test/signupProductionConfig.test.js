// An isolated database and disabled real mail/provider credentials. Missing
// CAPTCHA configuration must never silently bypass verification in production.
require('./helpers/testEnv');
process.env.TURNSTILE_SECRET = '';
process.env.HCAPTCHA_SECRET = '';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const authRouter = require('../server/routes/auth');

test('production signup fails closed when both verification secrets are missing', async () => {
  await db.ready;
  const originalEnvironment = process.env.NODE_ENV;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const email = 'unconfigured-production@example.test';
  try {
    process.env.NODE_ENV = 'production';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'test-only-password-123', captchaToken: 'unverified-token' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'CAPTCHA verification failed');
    assert.equal(await db.prepare('SELECT id FROM users WHERE email = ?').get(email), undefined);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    await new Promise((resolve) => server.close(resolve));
  }
});
