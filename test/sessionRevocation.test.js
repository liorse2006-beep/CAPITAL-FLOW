// Regression tests for the pre-launch audit's two "kill switch" fixes:
// admin Force-logout used to be a silent no-op (it still bumped the removed
// session_version column, which authMiddleware no longer checks), and a
// password reset never invalidated a leaked/stolen session on another
// device. Both now call auth.revokeAllSessions.
process.env.ADMIN_TOKEN = 'test-admin-token-1234567890123456789012';

require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
before(async () => { await db.ready; });

const { issueToken, refreshAccessToken, hashPassword, saveOTP } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');
const adminRouter = require('../server/routes/admin');
const authRouter = require('../server/routes/auth');

function startAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function startAuthApp() {
  const app = express();
  app.use(express.json());
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email, password) {
  const hash = password ? await hashPassword(password) : null;
  const result = await db
    .prepare('INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 1)')
    .run(email, hash);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('admin force-logout actually revokes the session (not the removed session_version column)', async () => {
  const user = await makeUser('force-logout-audit@test.local');
  const { accessToken } = await issueToken(user);
  assert.ok(await resolveToken(accessToken), 'token must start out valid');

  const server = await startAdminApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/users/${user.id}/logout`, {
      method: 'POST',
      headers: { 'X-Admin-Token': process.env.ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await resolveToken(accessToken), null, 'the token must be dead immediately after force-logout');
  } finally {
    server.close();
  }
});

test('admin force-logout revokes every session for the account, not just one', async () => {
  const user = await makeUser('force-logout-multi@test.local');
  const { accessToken: tokenA } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  const { accessToken: tokenB } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));

  const server = await startAdminApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/users/${user.id}/logout`, {
      method: 'POST',
      headers: { 'X-Admin-Token': process.env.ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await resolveToken(tokenA), null, 'device A must be logged out');
    assert.strictEqual(await resolveToken(tokenB), null, 'device B must be logged out too');
  } finally {
    server.close();
  }
});

test('resetting a password revokes every existing session — the actual fix for a leaked refresh token', async () => {
  const email = 'reset-revokes@test.local';
  const user = await makeUser(email, 'original-password-123');
  const { accessToken: oldToken, refreshToken: oldRefresh } = await issueToken(user);
  assert.ok(await resolveToken(oldToken), 'the pre-reset session must start out valid');

  await saveOTP(email, '123456', 'reset_password');

  const server = await startAuthApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456', newPassword: 'brand-new-password-456' }),
    });
    assert.strictEqual(res.status, 200);

    assert.strictEqual(await resolveToken(oldToken), null, 'the pre-reset access token must be dead');
    assert.strictEqual(await refreshAccessToken(oldRefresh), null, 'the pre-reset refresh token must be dead too — this is the actual leaked-token kill switch');

    const data = await res.json();
    assert.ok(await resolveToken(data.token), 'the NEW session issued by this same reset must still work');
  } finally {
    server.close();
  }
});

test('admin coupon routes: create, list, toggle, delete, all requiring admin auth', async () => {
  const server = await startAdminApp();
  const port = server.address().port;
  const H = { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.ADMIN_TOKEN };
  try {
    const unauth = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`);
    assert.strictEqual(unauth.status, 401);

    const create = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ code: 'adminroutetest', discountPercent: 15, appliesTo: 'elite', maxUses: 5 }),
    });
    assert.strictEqual(create.status, 200);

    const dupe = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ code: 'ADMINROUTETEST', discountPercent: 10, appliesTo: 'both' }),
    });
    assert.strictEqual(dupe.status, 409, 'a duplicate code (case-insensitively) must be rejected');

    const badPct = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ code: 'BADPERCENT', discountPercent: 150, appliesTo: 'both' }),
    });
    assert.strictEqual(badPct.status, 400);

    const list = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, { headers: H });
    const coupons = await list.json();
    const created = coupons.find((c) => c.code === 'ADMINROUTETEST');
    assert.ok(created, 'the created coupon must appear in the list, normalized to uppercase');
    assert.strictEqual(created.applies_to, 'elite');
    assert.strictEqual(created.active, 1);

    const toggle = await fetch(`http://127.0.0.1:${port}/admin/api/coupons/${created.id}/active`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ value: 0 }),
    });
    assert.strictEqual(toggle.status, 200);
    const afterToggle = await db.prepare('SELECT active FROM coupons WHERE id = ?').get(created.id);
    assert.strictEqual(afterToggle.active, 0);

    const del = await fetch(`http://127.0.0.1:${port}/admin/api/coupons/${created.id}`, { method: 'DELETE', headers: H });
    assert.strictEqual(del.status, 200);
    assert.strictEqual(await db.prepare('SELECT id FROM coupons WHERE id = ?').get(created.id), undefined);

    const auditRows = await db
      .prepare("SELECT action FROM admin_audit_log WHERE detail = 'ADMINROUTETEST' ORDER BY id")
      .all();
    assert.deepStrictEqual(
      auditRows.map((r) => r.action),
      ['coupon_create', 'coupon_disable', 'coupon_delete'],
      'every coupon mutation must be audit-logged'
    );
  } finally {
    server.close();
  }
});

test('admin manual backup run and feedback deletion are audit-logged', async () => {
  await db.prepare('INSERT INTO feedback (email, message) VALUES (?, ?)').run('audit-fb@test.local', 'test message');
  const fb = await db.prepare('SELECT id FROM feedback WHERE email = ?').get('audit-fb@test.local');

  const server = await startAdminApp();
  const port = server.address().port;
  const H = { 'X-Admin-Token': process.env.ADMIN_TOKEN };
  try {
    const del = await fetch(`http://127.0.0.1:${port}/admin/api/feedback/${fb.id}`, { method: 'DELETE', headers: H });
    assert.strictEqual(del.status, 200);
    const logged = await db.prepare("SELECT * FROM admin_audit_log WHERE action = 'delete_feedback' AND detail = ?").get('feedback #' + fb.id);
    assert.ok(logged, 'deleting feedback must leave an audit-log entry');
  } finally {
    server.close();
  }
});
