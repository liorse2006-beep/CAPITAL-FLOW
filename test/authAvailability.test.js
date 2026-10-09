require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const auth = require('../server/middleware/authMiddleware');
const { checkAdminToken } = require('../server/services/adminAccess');
let server;
let base;
let token;
before(async () => {
  await db.ready;
  const inserted = await db
    .prepare("INSERT INTO users (email,is_verified,tier,is_premium) VALUES ('admin@test.local',1,'elite',1)")
    .run();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
  token = (await issueToken(user)).accessToken;
  const app = express();
  app.use(express.json());
  for (const name of ['requireAuth', 'requirePremium', 'requirePremiumOrTrial', 'requireElite', 'requireEliteOrTrial'])
    app.get(`/${name}`, auth[name], (_req, res) => res.json({ ok: true }));
  app.get('/quota', auth.requireScanQuota('capitalFlow'), (_req, res) => res.json({ ok: true }));
  app.get('/status-admin', async (req, res) => {
    if (!(await checkAdminToken(req, res))) return;
    res.json({ ok: true });
  });
  app.use(require('../server/routes/admin'));
  app.use(require('../server/routes/feedback'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
function failSessionLookup(t) {
  const original = db.prepare;
  t.mock.method(db, 'prepare', (sql, ...args) => {
    if (/user_sessions/i.test(sql))
      return {
        get: async () => {
          throw new Error('private-database-url secret-token queue at capacity');
        },
      };
    return original(sql, ...args);
  });
}
for (const route of [
  'requireAuth',
  'requirePremium',
  'requirePremiumOrTrial',
  'requireElite',
  'requireEliteOrTrial',
  'quota',
  'status-admin',
  'admin/api/users',
  'feedback',
]) {
  test(`${route}: an unavailable authentication lookup is retryable, not a false logout or raw error`, async (t) => {
    failSessionLookup(t);
    const response = await fetch(`${base}/${route}`, {
      method: route === 'feedback' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(route === 'feedback' ? { body: JSON.stringify({ message: 'Synthetic isolated feedback' }) } : {}),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '5');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(await response.json(), {
      error: 'Sign-in is temporarily unavailable. Please try again shortly.',
      code: 'AUTH_UNAVAILABLE',
    });
    assert.equal(
      await db
        .prepare("SELECT COUNT(*) AS n FROM feedback WHERE message = 'Synthetic isolated feedback'")
        .get()
        .then((row) => row.n),
      0
    );
  });
}
test('recovery preserves the existing session, while malformed credentials stay rejected without DB access', async (t) => {
  const original = db.prepare;
  let fail = true;
  const spy = t.mock.method(db, 'prepare', (sql, ...args) => {
    if (fail && /user_sessions/i.test(sql))
      return {
        get: async () => {
          throw new Error('synthetic unavailable');
        },
      };
    return original(sql, ...args);
  });
  assert.equal((await fetch(`${base}/requireAuth`, { headers: { Authorization: `Bearer ${token}` } })).status, 503);
  fail = false;
  assert.equal((await fetch(`${base}/requireAuth`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  const calls = spy.mock.calls.length;
  assert.equal((await fetch(`${base}/requireAuth`, { headers: { Authorization: 'Bearer malformed' } })).status, 401);
  assert.equal(spy.mock.calls.length, calls);
});
