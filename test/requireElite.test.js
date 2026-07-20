// Regression test: notifications-adjacent features (watchlist alert
// thresholds, push subscribe) are Elite-only under the 3-tier system —
// Premium (and Free) must be rejected with NOT_ELITE, only Elite gets in.
// The one exception is requireEliteOrTrial: push subscribe/unsubscribe and
// watchlist alert thresholds are also opened up to a free account for as
// long as its 7-day trial is active (see server/services/scanQuota.js).
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const { requireElite, requireEliteOrTrial } = require('../server/middleware/authMiddleware');
const { FREE_TRIAL_DAYS } = require('../server/services/scanQuota');

async function makeUser(email, tier, { createdAt } = {}) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, ?, ?)')
    .run(email, tier, tier !== 'free' ? 1 : 0);
  if (createdAt) {
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, result.lastInsertRowid);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function startTestApp() {
  const app = express();
  app.get('/probe', requireElite, (req, res) => res.json({ ok: true, tier: req.user.tier }));
  app.get('/probe-trial', requireEliteOrTrial, (req, res) => res.json({ ok: true, tier: req.user.tier }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('requireElite rejects a free-tier user with NOT_ELITE', async () => {
  const user = await makeUser('elite-gate-free@test.local', 'free');
  const token = await issueToken(user);
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
  const user = await makeUser('elite-gate-premium@test.local', 'premium');
  const token = await issueToken(user);
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
  const user = await makeUser('elite-gate-elite@test.local', 'elite');
  const token = await issueToken(user);
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
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium, is_pilot) VALUES (?, 1, ?, 0, 1)')
    .run('elite-gate-pilot@test.local', 'free');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = await issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200, 'the pilot override must resolve to elite even though the DB column says free');
  } finally {
    server.close();
  }
});

test('requireEliteOrTrial allows a free-tier account still inside its 7-day trial', async () => {
  const user = await makeUser('trial-gate-fresh@test.local', 'free');
  const token = await issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe-trial`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200);
  } finally {
    server.close();
  }
});

test('requireEliteOrTrial rejects a free-tier account once its trial has elapsed', async () => {
  const user = await makeUser('trial-gate-expired@test.local', 'free', { createdAt: isoDaysAgo(FREE_TRIAL_DAYS + 1) });
  const token = await issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe-trial`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).code, 'NOT_ELITE');
  } finally {
    server.close();
  }
});

test('requireEliteOrTrial still rejects premium — the trial exception is free-tier only', async () => {
  const user = await makeUser('trial-gate-premium@test.local', 'premium');
  const token = await issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe-trial`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).code, 'NOT_ELITE');
  } finally {
    server.close();
  }
});

test('requireEliteOrTrial allows elite through as normal', async () => {
  const user = await makeUser('trial-gate-elite@test.local', 'elite');
  const token = await issueToken(user);
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe-trial`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200);
  } finally {
    server.close();
  }
});
