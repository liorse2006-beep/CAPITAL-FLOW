// server/services/whop.js, the webhook receiver, and the checkout
// transaction-creation endpoint. Sets Whop env vars before requiring
// anything that reads config — node:test runs each file in its own
// process, so this doesn't leak into other test files.
process.env.WHOP_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.WHOP_API_KEY = 'test-api-key';
process.env.WHOP_PREMIUM_PLAN_ID = 'plan_premium_test';
process.env.WHOP_ELITE_PLAN_ID = 'plan_elite_test';

require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const express = require('express');

const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const whop = require('../server/services/whop');
const webhooksRouter = require('../server/routes/webhooks');
const checkoutRouter = require('../server/routes/checkout');

before(async () => { await db.ready; });

function sign(rawBody, { id = 'wh_test_id', ts = String(Math.floor(Date.now() / 1000)), secret = 'test-webhook-secret' } = {}) {
  const sig = crypto.createHmac('sha256', secret).update(`${id}.${ts}.${rawBody}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

function startWebhookApp() {
  const app = express();
  app.use('/api/webhooks/whop', express.raw({ type: 'application/json' }));
  app.use('/api', webhooksRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function startCheckoutApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', checkoutRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email, tier = 'free') {
  const result = await db.prepare('INSERT INTO users (email, is_verified, tier) VALUES (?, 1, ?)').run(email, tier);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

// ── whop.verifyWebhookSignature ────────────────────────────────────────────

test('verifyWebhookSignature accepts a correctly signed body', () => {
  const body = JSON.stringify({ type: 'payment_succeeded' });
  assert.strictEqual(whop.verifyWebhookSignature(body, sign(body)), true);
});

test('verifyWebhookSignature rejects a tampered body', () => {
  const body = JSON.stringify({ type: 'payment_succeeded' });
  const headers = sign(body);
  const tampered = JSON.stringify({ type: 'payment_succeeded', amount: 999999 });
  assert.strictEqual(whop.verifyWebhookSignature(tampered, headers), false);
});

test('verifyWebhookSignature rejects missing signature headers', () => {
  assert.strictEqual(whop.verifyWebhookSignature('{}', {}), false);
});

test('verifyWebhookSignature rejects a malformed signature header', () => {
  assert.strictEqual(
    whop.verifyWebhookSignature('{}', { 'webhook-id': 'x', 'webhook-timestamp': '1', 'webhook-signature': 'not-valid' }),
    false
  );
});

// ── POST /api/webhooks/whop ─────────────────────────────────────────────────

test('webhook upgrades the user tier on payment_succeeded and redeems the coupon', async () => {
  const user = await makeUser('webhook-upgrade@test.local', 'free');
  await db.prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)').run(
    'WEBHOOK1',
    20,
    'both',
    0
  );

  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: { metadata: { userId: user.id, tier: 'premium', couponCode: 'WEBHOOK1' } },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);

    const updated = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'premium');
    assert.strictEqual(updated.is_premium, 1);

    const coupon = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('WEBHOOK1');
    assert.strictEqual(coupon.uses_count, 1);
  } finally {
    server.close();
  }
});

test('webhook redelivery with the same webhook-id does not double-redeem the coupon', async () => {
  const user = await makeUser('webhook-redelivery@test.local', 'free');
  await db.prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)').run(
    'WEBHOOK2',
    20,
    'both',
    0
  );

  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: { metadata: { userId: user.id, tier: 'premium', couponCode: 'WEBHOOK2' } },
  });
  const headers = sign(payload, { id: 'wh_redelivery_test_1' });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const send = () =>
      fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: payload,
      });

    const first = await send();
    assert.strictEqual(first.status, 200);
    const second = await send();
    assert.strictEqual(second.status, 200);
    const secondBody = await second.json();
    assert.strictEqual(secondBody.duplicate, true);

    const coupon = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('WEBHOOK2');
    assert.strictEqual(coupon.uses_count, 1);
  } finally {
    server.close();
  }
});

test('webhook rejects a request with an invalid signature', async () => {
  const payload = JSON.stringify({ type: 'payment_succeeded', data: {} });
  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'wh_bad',
        'webhook-timestamp': '1',
        'webhook-signature': 'v1,deadbeef',
      },
      body: payload,
    });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('webhook ignores event types other than payment_succeeded', async () => {
  const user = await makeUser('webhook-ignore@test.local', 'free');
  const payload = JSON.stringify({
    type: 'payment_created',
    data: { metadata: { userId: user.id, tier: 'elite' } },
  });
  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);
    const unchanged = await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(unchanged.tier, 'free');
  } finally {
    server.close();
  }
});

// ── POST /api/checkout/transaction ──────────────────────────────────────────

test('checkout/transaction requires auth', async () => {
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'premium' }),
    });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('checkout/transaction rejects an invalid tier', async () => {
  const user = await makeUser('checkout-badtier@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) },
      body: JSON.stringify({ tier: 'free' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('checkout/transaction rejects an invalid coupon before calling Whop', async () => {
  const user = await makeUser('checkout-badcoupon@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) },
      body: JSON.stringify({ tier: 'premium', couponCode: 'DOES-NOT-EXIST' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid coupon/i);
  } finally {
    server.close();
  }
});
