process.env.ADMIN_TOKEN = 'synthetic-static-token-'.padEnd(40, 'x');
process.env.STATUS_ADMIN_TOKEN = 'synthetic-status-token-'.padEnd(40, 'x');
process.env.INDEPENDENT_STATUS_SERVICE = 'false';
require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
let server;
let base;
let adminId;
let customers;

before(async () => {
  await db.ready;
  async function create(email, tier = 'free', pilot = 0) {
    const row = await db
      .prepare('INSERT INTO users (email, is_verified, tier, is_pilot) VALUES (?, 1, ?, ?)')
      .run(email, tier, pilot);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(row.lastInsertRowid);
  }
  adminId = (await create(process.env.ADMIN_EMAIL)).id;
  customers = await Promise.all([
    create('free@boundary.test'),
    create('elite@boundary.test', 'elite'),
    create('pilot@boundary.test', 'elite', 1),
  ]);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../server/routes/auth'));
  app.use(require('../server/routes/admin'));
  app.use(require('../server/routes/status'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
async function adminSession() {
  return issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(adminId));
}

test('guest navigation never receives an admin shell or a status-token login form', async () => {
  for (const path of ['/admin', '/status', '/status/admin', '/api/auth/admin', '/api/auth/status']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.doesNotMatch(
      await response.text(),
      /Activity Log|Run now|Admin sign in|Admin token|Operations console|<script/i
    );
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('free, paid, and pilot users cannot load either private page or use forged admin claims', async () => {
  for (const user of customers) {
    const { accessToken, refreshToken } = await issueToken(user);
    for (const path of ['/api/auth/admin', '/api/auth/status']) {
      assert.equal((await fetch(`${base}${path}`, { headers: { Cookie: `vs_refresh=${refreshToken}` } })).status, 404);
    }
    const forged = jwt.sign(
      {
        ...jwt.verify(accessToken, process.env.JWT_SECRET),
        email: process.env.ADMIN_EMAIL,
        is_admin: true,
        tier: 'elite',
      },
      process.env.JWT_SECRET
    );
    for (const path of ['/admin/api/users', '/status/api/summary']) {
      assert.equal((await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
    }
  }
});

test('the real admin can navigate in the same tab; its refresh cookie never authorizes API mutations', async () => {
  const { refreshToken, accessToken } = await adminSession();
  for (const [path, marker] of [
    ['/api/auth/admin', /Activity Log/],
    ['/api/auth/status', /Operations console/],
  ]) {
    const response = await fetch(`${base}${path}`, { headers: { Cookie: `vs_refresh=${refreshToken}` } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, marker);
    assert.doesNotMatch(html, /admin-token-input|PRODUCTION.*Turso|Admin sign in/);
    assert.equal(html.includes(refreshToken), false);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('set-cookie'), null, 'navigation is read-only, not a session-creation endpoint');
  }
  assert.equal(
    (await fetch(`${base}/admin/api/users`, { headers: { Cookie: `vs_refresh=${refreshToken}` } })).status,
    401
  );
  assert.equal(
    (await fetch(`${base}/admin/api/users`, { headers: { Authorization: `Bearer ${accessToken}` } })).status,
    200
  );
  assert.equal(
    (await fetch(`${base}/status/api/history`, { headers: { Authorization: `Bearer ${accessToken}` } })).status,
    200
  );
  for (const path of ['/admin/api/users', '/status/api/history']) {
    assert.equal(
      (await fetch(`${base}${path}`, { headers: { 'x-admin-token': process.env.ADMIN_TOKEN } })).status,
      401
    );
  }
});

test('blocked, unverified, demoted and revoked admin sessions fail closed immediately', async () => {
  for (const [column, value, restored] of [
    ['is_blocked', 1, 0],
    ['is_verified', 0, 1],
    ['email', 'former-admin@boundary.test', process.env.ADMIN_EMAIL],
  ]) {
    const session = await adminSession();
    await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(value, adminId);
    try {
      assert.equal(
        (await fetch(`${base}/api/auth/admin`, { headers: { Cookie: `vs_refresh=${session.refreshToken}` } })).status,
        404
      );
      assert.equal(
        (await fetch(`${base}/status/api/history`, { headers: { Authorization: `Bearer ${session.accessToken}` } }))
          .status,
        401
      );
    } finally {
      await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(restored, adminId);
    }
  }
  const session = await adminSession();
  await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(adminId);
  assert.equal(
    (await fetch(`${base}/api/auth/admin`, { headers: { Cookie: `vs_refresh=${session.refreshToken}` } })).status,
    404
  );
  assert.equal(
    (await fetch(`${base}/status/api/history`, { headers: { Authorization: `Bearer ${session.accessToken}` } })).status,
    401
  );
});

test('a copied legacy status cookie and static credentials cannot bypass the main account role', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 1000;
  const signature = crypto
    .createHmac('sha256', process.env.STATUS_ADMIN_TOKEN)
    .update(`status-admin:${expiresAt}`)
    .digest('base64url');
  const response = await fetch(`${base}/status/api/summary`, {
    headers: { Cookie: `cf_status_admin=${expiresAt}.${signature}` },
  });
  assert.equal(response.status, 401);
  assert.equal(
    (
      await fetch(`${base}/status/api/admin/session`, {
        method: 'POST',
        headers: { 'x-admin-token': process.env.STATUS_ADMIN_TOKEN },
      })
    ).status,
    404
  );
});

test('database lookup failure is a retryable 503 and never clears the session or exposes the shell', async (t) => {
  const { refreshToken } = await adminSession();
  const original = db.prepare;
  t.mock.method(db, 'prepare', (sql, ...args) =>
    /refresh_token_hash/.test(sql)
      ? {
          get: async () => {
            throw new Error('private-db-url secret-token');
          },
        }
      : original(sql, ...args)
  );
  for (const path of ['/api/auth/admin', '/api/auth/status']) {
    const response = await fetch(`${base}${path}`, { headers: { Cookie: `vs_refresh=${refreshToken}` } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '5');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.doesNotMatch(await response.text(), /private-db-url|secret-token|<script|Activity Log|Operations console/);
  }
});
