process.env.STATUS_ADMIN_TOKEN = 'test-status-admin-token-'.padEnd(40, 'x');
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const statusRouter = require('../server/routes/status');
const { RENDER_PROXY_HOPS } = require('../server/proxyTrust');

test('status limiters do not emit forwarded-header warnings when proxy trust is intentionally disabled', async () => {
  const app = express();
  app.set('trust proxy', false);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/status/api/admin/overview`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    assert.equal(response.status, 401);
    assert.equal(
      errors.some((entry) => entry.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')),
      false,
      'status limiter must not log the forwarded-header diagnostic'
    );
  } finally {
    console.error = originalError;
    server.close();
  }
});

test('status limiters accept the Render proxy chain without emitting a trust-proxy warning', async () => {
  const app = express();
  app.set('trust proxy', RENDER_PROXY_HOPS);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/status/api/admin/overview`, {
      headers: { 'X-Forwarded-For': '203.0.113.10, 198.51.100.20' },
    });
    assert.equal(response.status, 401);
    assert.equal(
      errors.some((entry) => entry.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')),
      false,
      'Render proxy configuration must not log the forwarded-header diagnostic'
    );
  } finally {
    console.error = originalError;
    server.close();
  }
});

test('unauthenticated status API requests remain protected by the dedicated per-IP budget', async () => {
  const app = express();
  app.set('trust proxy', RENDER_PROXY_HOPS);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const headers = { 'X-Forwarded-For': '203.0.113.250, 198.51.100.20' };
    let response;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await fetch(`http://127.0.0.1:${port}/status/api/summary`, { headers });
      if (attempt < 60) assert.notEqual(response.status, 429);
    }
    assert.equal(response.status, 429);
  } finally {
    server.close();
  }
});

test('status pages and status data require an authenticated operator session', async () => {
  const app = express();
  app.use(express.json());
  app.set('trust proxy', false);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const publicPage = await fetch(`${baseUrl}/status`, { redirect: 'manual' });
    assert.equal(publicPage.status, 302);
    assert.equal(publicPage.headers.get('location'), '/status/admin');

    const loginPage = await fetch(`${baseUrl}/status/admin`);
    const loginHtml = await loginPage.text();
    assert.equal(loginPage.status, 200);
    assert.match(loginHtml, /Admin sign in/);
    assert.doesNotMatch(loginHtml, /Availability history|Services and components|No active incidents/);
    assert.match(loginPage.headers.get('x-robots-tag') || '', /noindex/i);

    for (const path of ['/status/api/summary', '/status/api/history']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, `${path} should reject anonymous customers`);
    }
    const forgedSession = await fetch(`${baseUrl}/status/api/summary`, {
      headers: { Cookie: 'cf_status_admin=9999999999.invalid-signature' },
    });
    assert.equal(forgedSession.status, 401);

    const invalidLogin = await fetch(`${baseUrl}/status/api/admin/session`, {
      method: 'POST',
      headers: { 'x-admin-token': 'wrong-token' },
    });
    assert.equal(invalidLogin.status, 401);
    assert.equal(invalidLogin.headers.get('set-cookie'), null);

    const crossOriginLogin = await fetch(`${baseUrl}/status/api/admin/session`, {
      method: 'POST',
      headers: {
        origin: 'https://untrusted.example',
        'x-admin-token': process.env.STATUS_ADMIN_TOKEN,
      },
    });
    assert.equal(crossOriginLogin.status, 403);
    assert.equal(crossOriginLogin.headers.get('set-cookie'), null);

    const login = await fetch(`${baseUrl}/status/api/admin/session`, {
      method: 'POST',
      headers: { 'x-admin-token': process.env.STATUS_ADMIN_TOKEN },
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';', 1)[0];

    const adminPage = await fetch(`${baseUrl}/status/admin`, { headers: { Cookie: cookie } });
    assert.match(await adminPage.text(), /Operations console/);
    const summary = await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: cookie } });
    assert.equal(summary.status, 200);

    const rotatedLogin = await fetch(`${baseUrl}/status/api/admin/session`, {
      method: 'POST',
      headers: { Cookie: cookie, 'x-admin-token': process.env.STATUS_ADMIN_TOKEN },
    });
    assert.equal(rotatedLogin.status, 200);
    const rotatedCookie = rotatedLogin.headers.get('set-cookie').split(';', 1)[0];
    assert.equal(
      (await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: cookie } })).status,
      401,
      'replaced status sessions must be revoked'
    );
    const forbidden = await fetch(`${baseUrl}/status/api/admin/check-now`, {
      method: 'POST',
      headers: { Cookie: rotatedCookie, Origin: 'https://sibling.untrusted.example' },
    });
    assert.equal(forbidden.status, 403);

    const logout = await fetch(`${baseUrl}/status/api/admin/session/logout`, {
      method: 'POST',
      headers: { Cookie: rotatedCookie + '; cf_status_admin=junk' },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);
    const afterLogout = await fetch(`${baseUrl}/status/api/summary`);
    assert.equal(afterLogout.status, 401);
    const replay = await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: cookie } });
    assert.equal(replay.status, 401, 'a copied status cookie must also be revoked on logout');
    assert.equal(
      (await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: rotatedCookie } })).status,
      401,
      'ambiguous cookies must not silently skip revocation'
    );
  } finally {
    server.close();
  }
});

test('bearer-created status cookie follows current admin login revocation and block state', async () => {
  const db = require('../server/db');
  const auth = require('../server/services/auth');
  await db.ready;
  const inserted = await db
    .prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)')
    .run(process.env.ADMIN_EMAIL);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
  const app = express();
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = async (accessToken) => {
      const response = await fetch(`${baseUrl}/status/api/admin/session`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';', 1)[0];
    };
    const session = await auth.issueToken(user);
    const cookie = await login(session.accessToken);
    assert.equal((await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: cookie } })).status, 200);
    await auth.revokeSession(session.sessionId, user.id);
    assert.equal((await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: cookie } })).status, 401);
    const another = await auth.issueToken(user);
    const anotherCookie = await login(another.accessToken);
    await db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(user.id);
    assert.equal((await fetch(`${baseUrl}/status/api/summary`, { headers: { Cookie: anotherCookie } })).status, 401);
  } finally {
    server.close();
  }
});
