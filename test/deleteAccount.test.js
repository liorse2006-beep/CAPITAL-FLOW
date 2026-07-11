// DELETE /api/auth/account must cascade-remove every row keyed to the user
// (watchlist alerts, push subscriptions, feedback, pending OTPs) alongside
// the user row itself — the Privacy Policy promises immediate, permanent
// deletion, so this is a compliance guarantee, not just a nice-to-have.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const authRouter = require('../server/routes/auth');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, tier) VALUES (?, 1, ?)').run(email, 'elite');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('DELETE /api/auth/account removes the user and every associated row', async () => {
  const user = await makeUser('delete-me@test.local');
  const token = await issueToken(user);

  await db.prepare('INSERT INTO watchlist_alerts (user_id, symbol, min_ratio) VALUES (?, ?, ?)').run(user.id, 'AAPL', 3);
  await db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)').run(
    user.id,
    'https://push.example/' + user.id,
    'p256dh-key',
    'auth-key'
  );
  await db.prepare('INSERT INTO feedback (user_id, email, message) VALUES (?, ?, ?)').run(
    user.id,
    user.email,
    'test feedback'
  );
  await db.prepare('INSERT INTO otp_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)').run(
    user.email,
    '123456',
    'verify_email',
    Math.floor(Date.now() / 1000) + 900
  );

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/account`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);

    assert.strictEqual(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), undefined);
    assert.strictEqual(
      await db.prepare('SELECT * FROM watchlist_alerts WHERE user_id = ?').get(user.id),
      undefined
    );
    assert.strictEqual(
      await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get(user.id),
      undefined
    );
    assert.strictEqual(await db.prepare('SELECT * FROM feedback WHERE user_id = ?').get(user.id), undefined);
    assert.strictEqual(await db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(user.email), undefined);
  } finally {
    server.close();
  }
});

test('DELETE /api/auth/account requires auth', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/account`, { method: 'DELETE' });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('DELETE /api/auth/account only removes the requesting user, not others', async () => {
  const victim = await makeUser('delete-victim@test.local');
  const bystander = await makeUser('delete-bystander@test.local');
  const token = await issueToken(victim);

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/account`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await db.prepare('SELECT * FROM users WHERE id = ?').get(victim.id), undefined);
    assert.ok(await db.prepare('SELECT * FROM users WHERE id = ?').get(bystander.id));
  } finally {
    server.close();
  }
});
