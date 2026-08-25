// Account profile routes are the server-side source for the profile modal:
// aggregate usage, safe export, password rotation and session revocation.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');

const db = require('../server/db');
const accountRouter = require('../server/routes/account');
const { hashPassword, issueToken, resolveToken, verifyPassword } = (() => {
  const auth = require('../server/services/auth');
  return { ...auth, resolveToken: require('../server/middleware/authMiddleware').resolveToken };
})();

before(async () => {
  await db.ready;
});

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', accountRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email, password = 'correct horse battery staple') {
  const result = await db
    .prepare('INSERT INTO users (email, password_hash, is_verified, tier) VALUES (?, ?, 1, ?)')
    .run(email, await hashPassword(password), 'elite');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('GET /api/account/summary returns current counts without sensitive fields', async () => {
  const user = await makeUser('profile-summary@test.local');
  const token = (await issueToken(user)).accessToken;
  await db.prepare('INSERT INTO watchlist (user_id, symbol) VALUES (?, ?)').run(user.id, 'AAPL');
  await db
    .prepare('INSERT INTO watchlist_alerts (user_id, symbol, min_ratio) VALUES (?, ?, ?)')
    .run(user.id, 'AAPL', 2);
  await db
    .prepare('INSERT INTO scheduled_scans (user_id, scan_type, scan_time) VALUES (?, ?, ?)')
    .run(user.id, 'capitalFlow', '09:00');
  await db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(user.id, 'user', 'Hello');

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/account/summary`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.usage.watchlistCount, 1);
    assert.strictEqual(data.usage.alertCount, 1);
    assert.strictEqual(data.usage.scheduleCount, 1);
    assert.strictEqual(data.usage.chatMessageCount, 1);
    assert.strictEqual(data.security.activeSessionCount, 1);
    assert.strictEqual('password_hash' in data.user, false);
    assert.strictEqual('google_id' in data.user, false);
  } finally {
    server.close();
  }
});

test('POST /api/account/change-password rotates the current session and revokes the old one', async () => {
  const user = await makeUser('profile-password@test.local');
  const oldToken = (await issueToken(user)).accessToken;
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/account/change-password`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + oldToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'correct horse battery staple', newPassword: 'new secure password 123' }),
    });
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.token);
    assert.strictEqual(await resolveToken(oldToken), null);
    assert.ok(await resolveToken(data.token));
    const updated = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(await verifyPassword('new secure password 123', updated.password_hash), true);
  } finally {
    server.close();
  }
});

test('POST /api/account/change-password rejects an incorrect current password', async () => {
  const user = await makeUser('profile-password-bad@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/account/change-password`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong password', newPassword: 'new secure password 123' }),
    });
    assert.strictEqual(response.status, 400);
    assert.match((await response.json()).error, /current password/i);
  } finally {
    server.close();
  }
});

test('GET /api/account/export excludes credentials and push secrets', async () => {
  const user = await makeUser('profile-export@test.local');
  const token = (await issueToken(user)).accessToken;
  await db.prepare('INSERT INTO watchlist (user_id, symbol) VALUES (?, ?)').run(user.id, 'MSFT');
  await db
    .prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)')
    .run(user.id, 'https://push.example/profile-export', 'private-p256dh', 'private-auth');

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/account/export`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(response.status, 200);
    const exported = await response.text();
    assert.match(exported, /MSFT/);
    assert.doesNotMatch(exported, /password_hash|private-p256dh|private-auth|push\.example/);
    assert.match(response.headers.get('content-disposition'), /capital-flow-data\.json/);
  } finally {
    server.close();
  }
});
