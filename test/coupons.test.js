// Coupon bookkeeping (server/services/coupons.js) and the deprecated public
// validation route. Promo eligibility and discount calculation now belong to
// Whop; the app must never show a local discount that the provider may reject.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => {
  await db.ready;
});
const { validateCoupon, redeemCoupon } = require('../server/services/coupons');
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
  await db
    .prepare(
      'INSERT INTO coupons (code, discount_percent, applies_to, active, max_uses, uses_count, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(c.code, c.discount_percent, c.applies_to, c.active, c.max_uses, c.uses_count, c.expires_at);
  return c;
}

test('validateCoupon accepts a live "both" coupon for either tier', async () => {
  await insertCoupon({ code: 'BOTH1', applies_to: 'both' });
  const premium = await validateCoupon('both1', 'premium');
  const elite = await validateCoupon('BOTH1', 'elite');
  assert.strictEqual(premium.valid, true);
  assert.strictEqual(elite.valid, true);
  assert.strictEqual(premium.discountPercent, undefined);
  assert.strictEqual(elite.discountPercent, undefined);
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

test('redeemCoupon increments uses_count and reports success', async () => {
  await insertCoupon({ code: 'REDEEM1', max_uses: 5, uses_count: 0 });
  const ok = await redeemCoupon('redeem1');
  assert.strictEqual(ok, true);
  const row = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('REDEEM1');
  assert.strictEqual(row.uses_count, 1);
});

test('redeemCoupon refuses to exceed max_uses even for a single sequential call once maxed', async () => {
  await insertCoupon({ code: 'REDEEM2', max_uses: 1, uses_count: 1 });
  const ok = await redeemCoupon('REDEEM2');
  assert.strictEqual(ok, false);
  const row = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('REDEEM2');
  assert.strictEqual(row.uses_count, 1, 'must not overshoot max_uses');
});

test('two concurrent redemptions of a coupon with exactly one use left can never both succeed', async () => {
  // Regression for the TOCTOU race: validateCoupon (checked at checkout) and
  // redeemCoupon (called from the webhook) used to be two separate
  // operations with no shared lock, so two near-simultaneous webhook
  // deliveries for a max_uses=1 coupon could both pass and both increment.
  // The guard now lives inside redeemCoupon's own atomic UPDATE.
  await insertCoupon({ code: 'RACECOUPON', max_uses: 1, uses_count: 0 });
  const [a, b] = await Promise.all([redeemCoupon('RACECOUPON'), redeemCoupon('RACECOUPON')]);
  const successes = [a, b].filter(Boolean).length;
  assert.strictEqual(successes, 1, 'exactly one of the two concurrent redemptions must succeed');
  const row = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('RACECOUPON');
  assert.strictEqual(row.uses_count, 1, 'uses_count must never exceed max_uses');
});

test('redeemCoupon on an unlimited-use coupon (max_uses null) always succeeds', async () => {
  await insertCoupon({ code: 'UNLIMITED1', max_uses: null, uses_count: 500 });
  const ok = await redeemCoupon('UNLIMITED1');
  assert.strictEqual(ok, true);
});

test('POST /api/coupons/validate never returns a local discount', async () => {
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
    assert.strictEqual(res.status, 410);
    assert.strictEqual(body.valid, false);
    assert.strictEqual(body.code, 'provider_checkout_required');
    assert.strictEqual(body.discountPercent, undefined);
  } finally {
    server.close();
  }
});

test('POST /api/coupons/validate returns the provider-checkout message for every tier', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'X', tier: 'free' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 410);
    assert.strictEqual(body.code, 'provider_checkout_required');
  } finally {
    server.close();
  }
});
