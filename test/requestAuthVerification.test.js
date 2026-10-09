require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const auth = require('../server/services/auth');
before(async () => {
  await db.ready;
});

test('one protected HTTP request verifies its bearer once, but still rechecks the paid DB entitlement', async (t) => {
  const verify = auth.verifyToken;
  const spy = t.mock.method(auth, 'verifyToken', (...args) => verify(...args));
  const { requireAuth } = require('../server/middleware/authMiddleware');
  const { apiLimiter } = require('../server/middleware/rateLimiters');
  const inserted = await db
    .prepare("INSERT INTO users (email,is_verified,tier,is_premium) VALUES ('request-verify@test.local',1,'elite',1)")
    .run();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
  const token = (await auth.issueToken(user)).accessToken;
  const app = express();
  app.use(apiLimiter);
  app.get('/protected', requireAuth, (req, res) => res.json({ tier: req.user.tier }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/protected`;
    const calls = spy.mock.callCount();
    const first = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual(await first.json(), { tier: 'elite' });
    assert.equal(spy.mock.callCount() - calls, 1);
    await db.prepare("UPDATE users SET tier='premium' WHERE id=?").run(user.id);
    const second = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual(await second.json(), { tier: 'premium' });
    assert.equal(spy.mock.callCount() - calls, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('verification memoization is request-local, immutable, token-specific and never bypasses expiry', async (t) => {
  const { verifyRequestToken } = require('../server/services/requestAuthVerification');
  const verify = auth.verifyToken;
  const spy = t.mock.method(auth, 'verifyToken', (...args) => verify(...args));
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: 72, sid: 43 }, process.env.JWT_SECRET, { expiresIn: 60 });
  const request = {};
  const payload = verifyRequestToken(request, token);
  assert.ok(Object.isFrozen(payload));
  assert.equal(verifyRequestToken(request, token), payload);
  assert.equal(spy.mock.callCount(), 1);
  verifyRequestToken({}, token);
  assert.equal(spy.mock.callCount(), 2);
  assert.throws(() => verifyRequestToken(request, 'malformed'));
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 61000);
  assert.throws(() => verifyRequestToken(request, token), /expired/i);
});
