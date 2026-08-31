// GET /api/notifications/:id — the deep-link endpoint a scheduled-scan push
// notification opens: it must return that exact scan's results, be scoped to
// the owning user, and mark itself read once opened.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const { issueToken } = require('../server/services/auth');
const { addNotification } = require('../server/services/notifications');
const notificationsRouter = require('../server/routes/notifications');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', notificationsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run(email);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('GET /api/notifications/:id returns the scan results and marks it read', async () => {
  const user = await makeUser('notif-detail@test.local');
  const notifId = await addNotification(user.id, {
    symbol: 'TSLA',
    title: 'Volume spike detected — TSLA 5.0×',
    body: '3 stocks moving right now.',
    scanType: 'maScanner',
    results: [{ symbol: 'TSLA', price: 250, change: 4.2, maDistance: 1.8, direction: 'above' }],
  });

  const server = await startTestApp();
  const port = server.address().port;
  const headers = { Authorization: 'Bearer ' + (await issueToken(user)).accessToken };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/notifications/${notifId}`, { headers });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.scanType, 'maScanner');
    assert.strictEqual(body.results.length, 1);
    assert.strictEqual(body.results[0].symbol, 'TSLA');

    const row = await db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(notifId);
    assert.strictEqual(row.is_read, 1, 'opening the notification must mark it read');
  } finally {
    server.close();
  }
});

test("GET /api/notifications/:id never returns another user's notification", async () => {
  const owner = await makeUser('notif-owner@test.local');
  const intruder = await makeUser('notif-intruder@test.local');
  const notifId = await addNotification(owner.id, {
    symbol: 'AAPL',
    title: 'Volume spike',
    body: 'hi',
    scanType: 'capitalFlow',
    results: [{ symbol: 'AAPL' }],
  });

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/notifications/${notifId}`, {
      headers: { Authorization: 'Bearer ' + (await issueToken(intruder)).accessToken },
    });
    assert.strictEqual(res.status, 404);
  } finally {
    server.close();
  }
});

test('GET /api/notifications/:id returns 404 for a nonexistent id, and requires auth', async () => {
  const user = await makeUser('notif-404@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const authed = await fetch(`http://127.0.0.1:${port}/api/notifications/999999999`, {
      headers: { Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
    });
    assert.strictEqual(authed.status, 404);

    const noAuth = await fetch(`http://127.0.0.1:${port}/api/notifications/1`);
    assert.strictEqual(noAuth.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/notifications/:id rejects partially numeric and unsafe ids', async () => {
  const user = await makeUser('notif-invalid-id@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { Authorization: 'Bearer ' + (await issueToken(user)).accessToken };
  try {
    for (const id of ['1abc', '1.0', '0', '9007199254740992']) {
      const res = await fetch(`http://127.0.0.1:${port}/api/notifications/${id}`, { headers });
      assert.strictEqual(res.status, 400);
    }
  } finally {
    server.close();
  }
});

test('addNotification caps stored results at 50 rows', async () => {
  const user = await makeUser('notif-cap@test.local');
  const bigResults = Array.from({ length: 120 }, (_, i) => ({ symbol: 'SYM' + i }));
  const notifId = await addNotification(user.id, {
    title: 'Big scan',
    body: 'lots of results',
    scanType: 'sectorMoving',
    results: bigResults,
  });

  const row = await db.prepare('SELECT results_json FROM notifications WHERE id = ?').get(notifId);
  const stored = JSON.parse(row.results_json);
  assert.strictEqual(stored.length, 50, 'results must be capped, not stored unbounded');
});
