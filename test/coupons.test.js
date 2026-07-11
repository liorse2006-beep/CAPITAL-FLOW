// Coupon validation (server/services/coupons.js), the public validate
// endpoint, and the admin CRUD endpoints (server/routes/admin.js).
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const { validateCoupon } = require('../server/services/coupons');
const couponsRouter = require('../server/routes/coupons');
const adminRouter = require('../server/routes/admin');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', couponsRouter);
  app.use('/', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function adminAuthHeader() {
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get('admin@test.local');
  if (!user) {
    const result = await db
      .prepare('INSERT INTO users (email, is_verified, tier) VALUES (?, 1, ?)')
      .run('admin@test.local', 'elite');
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  return { Authorization: 'Bearer ' + (await issueToken(user)) };
}

async function insertCoupon(overrides = {}) {
  const c = {
    code: 'TESTCODE',
    discount_percent: 20,
    applies_to: 'both',
    active: 1,
    max_uses: null,
    uses_count: 0,
    expires_at: null,
    ...overrides,
  };
  await db.prepare(
    'INSERT INTO coupons (code, discount_percent, applies_to, active, max_uses, uses_count, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(c.code, c.discount_percent, c.applies_to, c.active, c.max_uses, c.uses_count, c.expires_at);
  return c;
}

test('validateCoupon accepts a live "both" coupon for either tier', async () => {
  await insertCoupon({ code: 'BOTH1', applies_to: 'both' });
  assert.strictEqual((await validateCoupon('both1', 'premium')).valid, true);
  assert.strictEqual((await validateCoupon('BOTH1', 'elite')).valid, true);
});

test('validateCoupon rejects a tier-scoped coupon used for the wrong tier', async () => {
  await insertCoupon({ code: 'PREMONLY', applies_to: 'premium' });
  const forPremium = await validateCoupon('PREMONLY', 'premium');
  const forElite = await validateCoupon('PREMONLY', 'elite');
  assert.strictEqual(forPremium.valid, true);
  assert.strictEqual(forElite.valid, false);
  assert.match(forElite.error, /premium/i);
});

test('validateCoupon rejects an unknown code', async () => {
  const result = await validateCoupon('NOPE', 'premium');
  assert.strictEqual(result.valid, false);
});

test('validateCoupon rejects a disabled coupon', async () => {
  await insertCoupon({ code: 'OFFCODE', active: 0 });
  assert.strictEqual((await validateCoupon('OFFCODE', 'premium')).valid, false);
});

test('validateCoupon rejects an expired coupon', async () => {
  await insertCoupon({ code: 'EXPIRED1', expires_at: Math.floor(Date.now() / 1000) - 3600 });
  const result = await validateCoupon('EXPIRED1', 'premium');
  assert.strictEqual(result.valid, false);
  assert.match(result.error, /expired/i);
});

test('validateCoupon rejects a coupon once it hits its max uses', async () => {
  await insertCoupon({ code: 'MAXEDOUT', max_uses: 2, uses_count: 2 });
  const result = await validateCoupon('MAXEDOUT', 'premium');
  assert.strictEqual(result.valid, false);
  assert.match(result.error, /limit/i);
});

test('POST /api/coupons/validate returns the discount for a valid code', async () => {
  await insertCoupon({ code: 'PUBLICV', discount_percent: 15, applies_to: 'both' });
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'publicv', tier: 'premium' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.valid, true);
    assert.strictEqual(body.discountPercent, 15);
  } finally {
    server.close();
  }
});

test('POST /api/coupons/validate rejects an invalid tier', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'X', tier: 'free' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('admin can create a coupon with an explicit code and scope', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', ...(await adminAuthHeader()) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: 'mycode', discountPercent: 30, appliesTo: 'elite' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.code, 'MYCODE');

    const row = await db.prepare('SELECT * FROM coupons WHERE code = ?').get('MYCODE');
    assert.strictEqual(row.discount_percent, 30);
    assert.strictEqual(row.applies_to, 'elite');
  } finally {
    server.close();
  }
});

test('admin creating a coupon with no code gets an auto-generated one', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', ...(await adminAuthHeader()) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ discountPercent: 10 }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.code && body.code.length >= 3);
  } finally {
    server.close();
  }
});

test('admin cannot create two coupons with the same code', async () => {
  await insertCoupon({ code: 'DUPE1' });
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', ...(await adminAuthHeader()) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: 'dupe1', discountPercent: 10 }),
    });
    assert.strictEqual(res.status, 409);
  } finally {
    server.close();
  }
});

test('admin coupon routes reject requests without a valid token', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/coupons`);
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('admin can toggle a coupon inactive, and it then fails validation', async () => {
  await insertCoupon({ code: 'TOGGLEME' });
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', ...(await adminAuthHeader()) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/coupons/TOGGLEME/toggle`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ active: false }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await validateCoupon('TOGGLEME', 'premium')).valid, false);
  } finally {
    server.close();
  }
});

test('admin can delete a coupon', async () => {
  await insertCoupon({ code: 'DELETEME' });
  const server = await startTestApp();
  const port = server.address().port;
  const headers = await adminAuthHeader();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/coupons/DELETEME`, {
      method: 'DELETE',
      headers,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await db.prepare('SELECT * FROM coupons WHERE code = ?').get('DELETEME'), undefined);
  } finally {
    server.close();
  }
});
