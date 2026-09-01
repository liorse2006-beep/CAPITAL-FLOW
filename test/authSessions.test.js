// Multi-device session model: server/services/auth.js (createSession,
// refreshAccessToken, revokeSession) and the HTTP routes that expose them
// (POST /api/auth/refresh reading the httpOnly cookie, POST /api/auth/logout
// revoking one device without touching the others).
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const { issueToken, createSession, refreshAccessToken, revokeSession } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');
const authRouter = require('../server/routes/auth');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run(email);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

// Extracts just the cookie's value from a raw Set-Cookie header, e.g.
// "vs_refresh=abc123; Path=/api/auth; HttpOnly" -> "abc123".
function extractCookieValue(setCookieHeader, name) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader.find((c) => c.startsWith(name + '=')) : setCookieHeader;
  if (!raw) return null;
  return raw.split(';')[0].split('=').slice(1).join('=');
}

test('refreshAccessToken exchanges a valid refresh token for a new access token', async () => {
  const user = await makeUser('refresh-a@test.local');
  const { refreshToken, sessionId } = await createSession(user.id);

  const result = await refreshAccessToken(refreshToken);
  assert.ok(result, 'a valid refresh token must mint a new access token');
  assert.strictEqual(result.user.id, user.id);

  const resolved = await resolveToken(result.accessToken);
  assert.ok(resolved, 'the freshly minted access token must resolve to a real user');
  assert.strictEqual(resolved.id, user.id);
  void sessionId;
});

test('refreshAccessToken rejects a garbage/unknown token', async () => {
  assert.strictEqual(await refreshAccessToken('not-a-real-token'), null);
  assert.strictEqual(await refreshAccessToken(''), null);
  assert.strictEqual(await refreshAccessToken(null), null);
});

test('revokeSession invalidates only that session — a sibling session on the same account is untouched', async () => {
  const user = await makeUser('refresh-b@test.local');
  const { refreshToken: refreshA, sessionId: sidA } = await createSession(user.id);
  const { refreshToken: refreshB } = await createSession(user.id);

  await revokeSession(sidA, user.id);

  assert.strictEqual(await refreshAccessToken(refreshA), null, 'the revoked session must no longer refresh');
  assert.ok(await refreshAccessToken(refreshB), 'the sibling session must still work');
});

// Regression: createSession used to SELECT the existing session count, then
// DELETE the excess in a loop, then INSERT — a real gap between the read and
// the write. Five logins fired at once (e.g. several devices signing in
// within the same instant, or a retried request racing the original) could
// each read "under the cap" before any of them had evicted anything, letting
// the account end up with more than MAX_ACTIVE_SESSIONS active sessions at
// once. createSession now inserts first and prunes with a single
// self-contained DELETE, which has no such gap.
test('N concurrent logins on one account never leave more than MAX_ACTIVE_SESSIONS sessions active', async () => {
  const { MAX_ACTIVE_SESSIONS } = require('../server/services/auth');
  const user = await makeUser('concurrent-login@test.local');

  await Promise.all(Array.from({ length: 5 }, () => createSession(user.id)));

  const rows = await db.prepare('SELECT id FROM user_sessions WHERE user_id = ?').all(user.id);
  assert.strictEqual(
    rows.length,
    MAX_ACTIVE_SESSIONS,
    `expected exactly ${MAX_ACTIVE_SESSIONS} surviving sessions after 5 concurrent logins, got ${rows.length}`
  );
});

test('POST /api/auth/refresh mints a new access token from the httpOnly cookie set at login', async () => {
  const user = await makeUser('refresh-route-a@test.local');
  const { refreshToken } = await issueToken(user);

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `vs_refresh=${refreshToken}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.token, 'a new access token must be returned');
    const resolved = await resolveToken(data.token);
    assert.strictEqual(resolved.id, user.id);
  } finally {
    server.close();
  }
});

test('POST /api/auth/refresh with no cookie (or a stale one) is rejected', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const noCookie = await fetch(`http://localhost:${port}/api/auth/refresh`, { method: 'POST' });
    assert.strictEqual(noCookie.status, 401);

    const badCookie = await fetch(`http://localhost:${port}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: 'vs_refresh=totally-made-up' },
    });
    assert.strictEqual(badCookie.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/auth/logout revokes this device only, and clears the refresh cookie', async () => {
  const user = await makeUser('logout-a@test.local');
  const { accessToken: tokenA, refreshToken: refreshA } = await issueToken(
    await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  );
  const { refreshToken: refreshB } = await issueToken(
    await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  );

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenA },
    });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.startsWith('vs_refresh=;'), 'the refresh cookie must be cleared');

    assert.strictEqual(await refreshAccessToken(refreshA), null, 'the logged-out device session must be gone');
    assert.ok(await refreshAccessToken(refreshB), 'the other device (never logged out) must still work');
  } finally {
    server.close();
  }
});

test('POST /api/auth/logout still revokes the cookie session when the access token has expired', async () => {
  const user = await makeUser('logout-expired-token@test.local');
  const { refreshToken } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `vs_refresh=${refreshToken}`, Authorization: 'Bearer expired-or-invalid' },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
    assert.strictEqual(await refreshAccessToken(refreshToken), null, 'logout must revoke the cookie session');
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.startsWith('vs_refresh=;'), 'the refresh cookie must be cleared');
  } finally {
    server.close();
  }
});

test('a fresh login sets an httpOnly vs_refresh cookie scoped to /api/auth', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    await db
      .prepare('INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 1)')
      .run(
        'login-cookie@test.local',
        await require('../server/services/auth').hashPassword('correct horse battery staple')
      );
    const res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login-cookie@test.local', password: 'correct horse battery staple' }),
    });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie.includes('vs_refresh='), 'login must set the refresh cookie');
    assert.ok(/HttpOnly/i.test(setCookie), 'the refresh cookie must be httpOnly');
    assert.ok(setCookie.includes('Path=/api/auth'), 'the refresh cookie must be scoped to /api/auth');
    const token = extractCookieValue(setCookie, 'vs_refresh');
    assert.ok(await refreshAccessToken(token), 'the cookie value set at login must itself be a valid refresh token');
  } finally {
    server.close();
  }
});
