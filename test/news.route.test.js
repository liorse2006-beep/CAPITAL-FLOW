// GET /api/news/:symbol gating — Elite gets it always, free-tier only
// during their 7-day trial, matching the same requireEliteOrTrial policy
// already used for watchlist alerts.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const newsRouter = require('../server/routes/news');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', newsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email, overrides = {}) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, created_at) VALUES (?, 1, ?, ?)')
    .run(email, overrides.tier || 'free', overrides.createdAt || Math.floor(Date.now() / 1000));
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('GET /api/news/:symbol requires auth', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/news/AAPL`);
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('a free-tier account past its 7-day trial is rejected with NOT_ELITE', async () => {
  const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
  const user = await makeUser('news-expired-trial@test.local', { createdAt: eightDaysAgo });
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/news/AAPL`, {
      headers: { Authorization: 'Bearer ' + (await issueToken(user)) },
    });
    assert.strictEqual(res.status, 403);
  } finally {
    server.close();
  }
});

test('an elite account can reach the route (past auth, rejected only on a malformed symbol)', async () => {
  const user = await makeUser('news-elite@test.local', { tier: 'elite' });
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/news/${encodeURIComponent('not a symbol!')}`, {
      headers: { Authorization: 'Bearer ' + (await issueToken(user)) },
    });
    assert.strictEqual(res.status, 400, 'auth passed — the request got far enough to hit symbol validation');
  } finally {
    server.close();
  }
});
