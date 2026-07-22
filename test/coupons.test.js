// Coupon validation (server/services/coupons.js) and the public validate
// endpoint. Coupons are now created/managed exclusively through Whop's own
// promo codes — there is no admin CRUD for this app's internal coupon
// system anymore, so there's nothing to test there.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { validateCoupon } = require('../server/services/coupons');
const couponsRouter = require('../server/routes/coupons');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', couponsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
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
