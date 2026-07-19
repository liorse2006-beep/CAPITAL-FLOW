// Regression tests for the 3-tier scan quota system:
//  - free:    unlimited scans for FREE_TRIAL_DAYS from account creation,
//             then blocked entirely until upgrade — purely time-gated
//  - premium: a shared pool of 5 scans per rolling 24h across all categories
//  - elite:   unlimited (pilot accounts resolve to elite too)
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const { requireScanQuota } = require('../server/middleware/authMiddleware');
const { canScan, spendScan, quotaFor, PREMIUM_DAILY_LIMIT, FREE_TRIAL_DAYS } = require('../server/services/scanQuota');

async function makeUser(email, { tier = 'free', isPilot = false, createdAt } = {}) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium, is_pilot) VALUES (?, 1, ?, ?, ?)')
    .run(email, tier, tier !== 'free' ? 1 : 0, isPilot ? 1 : 0);
  if (createdAt) {
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, result.lastInsertRowid);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function reload(id) {
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

test('free tier: a brand-new account can scan any category, unlimited', async () => {
  const user = await makeUser('free-a@test.local');
  assert.strictEqual(canScan(user, 'capitalFlow'), true);
  assert.strictEqual(canScan(user, 'maScanner'), true);
  assert.strictEqual(canScan(user, 'sectorMoving'), true);

  // spending never affects a free account — it's purely time-gated
  await spendScan(user, 'capitalFlow');
  assert.strictEqual(canScan(user, 'capitalFlow'), true, 'scanning does not consume anything for free tier');
});

test('free tier: still unlimited right up to the last moment of day 7', async () => {
  const user = await makeUser('free-almost@test.local', {
    createdAt: isoDaysAgo(FREE_TRIAL_DAYS - 0.01),
  });
  assert.strictEqual(canScan(user, 'capitalFlow'), true);
});

test('free tier: blocked in every category once the 7-day trial has elapsed', async () => {
  const user = await makeUser('free-expired@test.local', { createdAt: isoDaysAgo(FREE_TRIAL_DAYS + 1) });
  assert.strictEqual(canScan(user, 'capitalFlow'), false);
  assert.strictEqual(canScan(user, 'maScanner'), false);
  assert.strictEqual(canScan(user, 'sectorMoving'), false);
});

test('free tier: requireScanQuota blocks every category once the trial has elapsed', async () => {
  const user = await makeUser('free-b@test.local', { createdAt: isoDaysAgo(FREE_TRIAL_DAYS + 1) });
  const token = await issueToken(await reload(user.id));

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const blocked = await fetch(`http://127.0.0.1:${port}/capital-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual((await blocked.json()).code, 'SCAN_LIMIT');

    const alsoBlocked = await fetch(`http://127.0.0.1:${port}/ma-scanner`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(alsoBlocked.status, 403, 'the trial ending blocks every category, not just one');
  } finally {
    server.close();
  }
});

test('quotaFor reports trialActive and trialEndsAt for a free account', async () => {
  const fresh = await makeUser('free-quota-fresh@test.local');
  const freshQuota = quotaFor(fresh);
  assert.strictEqual(freshQuota.free.trialActive, true);
  assert.ok(new Date(freshQuota.free.trialEndsAt).getTime() > Date.now());

  const expired = await makeUser('free-quota-expired@test.local', { createdAt: isoDaysAgo(FREE_TRIAL_DAYS + 1) });
  const expiredQuota = quotaFor(expired);
  assert.strictEqual(expiredQuota.free.trialActive, false);
});

test('premium tier: a shared pool of 5 scans across every category, blocked on the 6th', async () => {
  const user = await makeUser('premium-a@test.local', { tier: 'premium' });
  let u = user;
  const categories = ['capitalFlow', 'maScanner', 'sectorMoving', 'capitalFlow', 'maScanner'];
  for (const cat of categories) {
    assert.strictEqual(canScan(u, cat), true);
    await spendScan(u, cat);
    u = await reload(user.id);
  }
  assert.strictEqual(u.premium_scan_count, 5);
  assert.strictEqual(canScan(u, 'sectorMoving'), false, 'the 6th scan of the day must be blocked');

  const quota = quotaFor(u);
  assert.strictEqual(quota.premium.used, 5);
  assert.strictEqual(quota.premium.left, 0);
});

test('premium tier: the pool resets once the 24h window has elapsed', async () => {
  const user = await makeUser('premium-b@test.local', { tier: 'premium' });
  await db.prepare('UPDATE users SET premium_scan_count = 5, premium_scan_window_start = ? WHERE id = ?').run(
    Math.floor(Date.now() / 1000) - 25 * 60 * 60,
    user.id
  ); // 25h ago — window expired
  const stale = await reload(user.id);

  assert.strictEqual(canScan(stale, 'capitalFlow'), true, 'an expired window must not block scanning');
  await spendScan(stale, 'capitalFlow');
  const fresh = await reload(user.id);
  assert.strictEqual(fresh.premium_scan_count, 1, 'spending after expiry must restart the count at 1, not 6');
});

test('elite tier is never limited, no matter how many scans it racks up', async () => {
  const user = await makeUser('elite-a@test.local', { tier: 'elite' });
  for (let i = 0; i < 20; i++) await spendScan(await reload(user.id), 'capitalFlow');
  const token = await issueToken(await reload(user.id));

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
  const user = await makeUser('quota-pilot@test.local', { tier: 'free', isPilot: true });
  await spendScan(user, 'capitalFlow');
  await spendScan(await reload(user.id), 'maScanner');
  await spendScan(await reload(user.id), 'sectorMoving');
  const token = await issueToken(await reload(user.id));

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/capital-flow`, { headers: { Authorization: 'Bearer ' + token } });
    assert.strictEqual(res.status, 200, 'a pilot account must bypass every tier limit via the elite override');
  } finally {
    server.close();
  }
});
