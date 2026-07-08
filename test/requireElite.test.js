// Regression test: notifications-adjacent features (watchlist alert
// thresholds, push subscribe) are Elite-only under the 3-tier system —
// Premium (and Free) must be rejected with NOT_ELITE, only Elite gets in.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const { requireElite } = require('../server/middleware/authMiddleware');

function makeUser(email, tier) {
  const id = db.prepare('INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, ?, ?)')
    .run(email, tier, tier !== 'free' ? 1 : 0).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function startTestApp() {
  const app = express();
  app.get('/probe', requireElite, (req, res) => res.json({ ok: true, tier: req.user.tier }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('requireElite rejects a free-tier user with NOT_ELITE', async () => {
  const user = makeUser('elite-gate-free@test.local', 'free');
  const token = issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).code, 'NOT_ELITE');
  } finally {
    server.close();
  }
});

test('requireElite rejects a premium-tier user with NOT_ELITE — premium has scanning, not notifications', async () => {
  const user = makeUser('elite-gate-premium@test.local', 'premium');
  const token = issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).code, 'NOT_ELITE');
  } finally {
    server.close();
  }
});

test('requireElite allows an elite-tier user through', async () => {
  const user = makeUser('elite-gate-elite@test.local', 'elite');
  const token = issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).tier, 'elite');
  } finally {
    server.close();
  }
});

test('requireElite allows a pilot account through, even with tier=free in the DB', async () => {
  const id = db.prepare('INSERT INTO users (email, is_verified, tier, is_premium, is_pilot) VALUES (?, 1, ?, 0, 1)')
    .run('elite-gate-pilot@test.local', 'free').lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200, 'the pilot override must resolve to elite even though the DB column says free');
  } finally {
    server.close();
  }
});
