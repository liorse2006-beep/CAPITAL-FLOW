// Regression tests for the 3-tier scan quota system:
//  - free:    one lifetime trial scan per category (independent, not shared)
//  - premium: a shared pool of 5 scans per rolling 24h across all categories
//  - elite:   unlimited (pilot accounts resolve to elite too)
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const { requireScanQuota } = require('../server/middleware/authMiddleware');
const { canScan, spendScan, quotaFor, PREMIUM_DAILY_LIMIT } = require('../server/services/scanQuota');

function makeUser(email, { tier = 'free', isPilot = false } = {}) {
  const id = db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium, is_pilot) VALUES (?, 1, ?, ?, ?)')
    .run(email, tier, tier !== 'free' ? 1 : 0, isPilot ? 1 : 0).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function reload(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function startTestApp() {
  const app = express();
  app.get('/capital-flow', requireScanQuota('capitalFlow'), (req, res) => res.json(quotaFor(req.user)));
  app.get('/ma-scanner', requireScanQuota('maScanner'), (req, res) => res.json(quotaFor(req.user)));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('PREMIUM_DAILY_LIMIT is 5', () => {
  assert.strictEqual(PREMIUM_DAILY_LIMIT, 5);
});

test('anonymous requests are rejected — every scan type still requires login', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/capital-flow`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'NOT_AUTHENTICATED');
  } finally {
    server.close();
  }
});

test('free tier: each category gets its own one-time trial, independent of the others', () => {
  const user = makeUser('free-a@test.local');
  assert.strictEqual(canScan(user, 'capitalFlow'), true);
  assert.strictEqual(canScan(user, 'maScanner'), true);

  spendScan(user, 'capitalFlow');

  assert.strictEqual(canScan(user, 'capitalFlow'), false, 'capitalFlow trial is now spent');
  assert.strictEqual(canScan(user, 'maScanner'), true, 'maScanner trial is untouched by capitalFlow');
  assert.strictEqual(canScan(user, 'sectorMoving'), true, 'sectorMoving trial is untouched too');
});

test('free tier: requireScanQuota blocks a category after its trial is used, but not a different category', async () => {
  const user = makeUser('free-b@test.local');
  spendScan(user, 'capitalFlow');
  const token = issueToken(reload(user.id));

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const blocked = await fetch(`http://127.0.0.1:${port}/capital-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual((await blocked.json()).code, 'SCAN_LIMIT');

    const allowed = await fetch(`http://127.0.0.1:${port}/ma-scanner`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(allowed.status, 200, 'a different category must still be usable');
  } finally {
    server.close();
  }
});

test('free tier trial never resets — spending it stays spent', () => {
  const user = makeUser('free-c@test.local');
  spendScan(user, 'sectorMoving');
  const fresh = reload(user.id);
  assert.strictEqual(canScan(fresh, 'sectorMoving'), false);
});

test('premium tier: a shared pool of 5 scans across every category, blocked on the 6th', () => {
  const user = makeUser('premium-a@test.local', { tier: 'premium' });
  let u = user;
  const categories = ['capitalFlow', 'maScanner', 'sectorMoving', 'capitalFlow', 'maScanner'];
  categories.forEach((cat) => {
    assert.strictEqual(canScan(u, cat), true);
    spendScan(u, cat);
    u = reload(user.id);
  });
  assert.strictEqual(u.premium_scan_count, 5);
  assert.strictEqual(canScan(u, 'sectorMoving'), false, 'the 6th scan of the day must be blocked');

  const quota = quotaFor(u);
  assert.strictEqual(quota.premium.used, 5);
  assert.strictEqual(quota.premium.left, 0);
});

test('premium tier: the pool resets once the 24h window has elapsed', () => {
  const user = makeUser('premium-b@test.local', { tier: 'premium' });
  db.prepare('UPDATE users SET premium_scan_count = 5, premium_scan_window_start = ? WHERE id = ?').run(
    Math.floor(Date.now() / 1000) - 25 * 60 * 60,
    user.id
  ); // 25h ago — window expired
  const stale = reload(user.id);

  assert.strictEqual(canScan(stale, 'capitalFlow'), true, 'an expired window must not block scanning');
  spendScan(stale, 'capitalFlow');
  const fresh = reload(user.id);
  assert.strictEqual(fresh.premium_scan_count, 1, 'spending after expiry must restart the count at 1, not 6');
});

test('elite tier is never limited, no matter how many scans it racks up', async () => {
  const user = makeUser('elite-a@test.local', { tier: 'elite' });
  for (let i = 0; i < 20; i++) spendScan(reload(user.id), 'capitalFlow');
  const token = issueToken(reload(user.id));

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/capital-flow`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.tier, 'elite');
    assert.strictEqual(body.premium, null);
    assert.strictEqual(body.free, null);
  } finally {
    server.close();
  }
});

test('a free pilot account resolves to elite and is never blocked', async () => {
  const user = makeUser('quota-pilot@test.local', { tier: 'free', isPilot: true });
  spendScan(user, 'capitalFlow');
  spendScan(reload(user.id), 'maScanner');
  spendScan(reload(user.id), 'sectorMoving');
  const token = issueToken(reload(user.id));

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/capital-flow`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200, 'a pilot account must bypass every tier limit via the elite override');
  } finally {
    server.close();
  }
});
