// CAPTCHA enforcement (server/routes/auth.js) — once TURNSTILE_SECRET is
// configured, a signup with no captcha token must be rejected outright, not
// silently waved through. Set before any require so config.js sees it.
process.env.TURNSTILE_SECRET = 'test-turnstile-secret';

require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const authRouter = require('../server/routes/auth');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('signup with no captcha token is rejected when Turnstile is configured', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'captcha-bypass@test.local', password: 'password123' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /captcha/i);

    const user = await db.prepare('SELECT id FROM users WHERE email = ?').get('captcha-bypass@test.local');
    assert.strictEqual(user, undefined, 'no account may be created without passing the CAPTCHA');
  } finally {
    server.close();
  }
});
