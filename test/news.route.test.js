// GET /api/news/:symbol gating — News is available to every signed-in
// tier (not a paid differentiator), so this only needs to check auth, not
// tier or trial status.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const newsRouter = require('../server/routes/news');
const { newsCache } = require('../server/services/newsService');

const originalFetch = global.fetch;

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

test('a free-tier account past its 7-day trial can still reach news (not a paid differentiator)', async () => {
  const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
  const user = await makeUser('news-expired-trial@test.local', { createdAt: eightDaysAgo });
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

test('GET /api/news/:symbol/resolve rejects a url that was never actually returned for that symbol', async () => {
  const user = await makeUser('news-resolve-unknown@test.local', { tier: 'elite' });
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/news/RSLV/resolve?url=${encodeURIComponent('https://evil.example.com/ssrf')}`,
      { headers: { Authorization: 'Bearer ' + (await issueToken(user)) } }
    );
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('GET /api/news/:symbol/resolve follows a redirect for a url that was actually cached for that symbol', async () => {
  newsCache.set('RSLV2', {
    articles: [{ headline: 'h', url: 'https://finnhub.io/track/abc', datetime: 0 }],
    fetchTime: Date.now(),
    source: 'finnhub',
  });
  global.fetch = async (url, opts) => {
    if (url !== 'https://finnhub.io/track/abc') return originalFetch(url, opts);
    assert.strictEqual(opts.method, 'HEAD');
    return { url: 'https://real-publisher.example.com/article' };
  };

  const user = await makeUser('news-resolve-known@test.local', { tier: 'elite' });
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/news/RSLV2/resolve?url=${encodeURIComponent('https://finnhub.io/track/abc')}`,
      { headers: { Authorization: 'Bearer ' + (await issueToken(user)) } }
    );
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.url, 'https://real-publisher.example.com/article');
  } finally {
    server.close();
    global.fetch = originalFetch;
    newsCache.delete('RSLV2');
  }
});
