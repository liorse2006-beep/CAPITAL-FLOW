// server/services/paddle.js, the webhook receiver, and the checkout
// transaction-creation endpoint. Sets Paddle env vars before requiring
// anything that reads config — node:test runs each file in its own
// process, so this doesn't leak into other test files.
process.env.PADDLE_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.PADDLE_API_KEY = 'test-api-key';
process.env.PADDLE_PREMIUM_PRICE_ID = 'pri_premium_test';
process.env.PADDLE_ELITE_PRICE_ID = 'pri_elite_test';

require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const express = require('express');

const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const paddle = require('../server/services/paddle');
const webhooksRouter = require('../server/routes/webhooks');
const checkoutRouter = require('../server/routes/checkout');

function sign(rawBody, ts = Math.floor(Date.now() / 1000)) {
  const h1 = crypto.createHmac('sha256', 'test-webhook-secret').update(`${ts}:${rawBody}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function startWebhookApp() {
  const app = express();
  app.use('/api/webhooks/paddle', express.raw({ type: 'application/json' }));
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

function makeUser(email, tier = 'free') {
  const id = db.prepare('INSERT INTO users (email, is_verified, tier) VALUES (?, 1, ?)').run(email, tier)
    .lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// ── paddle.verifyWebhookSignature ──────────────────────────────────────────

test('verifyWebhookSignature accepts a correctly signed body', () => {
  const body = JSON.stringify({ event_type: 'transaction.completed' });
  assert.strictEqual(paddle.verifyWebhookSignature(body, sign(body)), true);
});

test('verifyWebhookSignature rejects a tampered body', () => {
  const body = JSON.stringify({ event_type: 'transaction.completed' });
  const signature = sign(body);
  const tampered = JSON.stringify({ event_type: 'transaction.completed', amount: 999999 });
  assert.strictEqual(paddle.verifyWebhookSignature(tampered, signature), false);
});

test('verifyWebhookSignature rejects a missing signature header', () => {
  assert.strictEqual(paddle.verifyWebhookSignature('{}', undefined), false);
});

test('verifyWebhookSignature rejects a malformed signature header', () => {
  assert.strictEqual(paddle.verifyWebhookSignature('{}', 'not-a-valid-header'), false);
});

// ── POST /api/webhooks/paddle ───────────────────────────────────────────────

test('webhook upgrades the user tier on transaction.completed and redeems the coupon', async () => {
  const user = makeUser('webhook-upgrade@test.local', 'free');
  db.prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)').run(
    'WEBHOOK1',
    20,
    'both',
    0
  );

  const payload = JSON.stringify({
    event_type: 'transaction.completed',
    data: { custom_data: { userId: user.id, tier: 'premium', couponCode: 'WEBHOOK1' } },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/paddle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': sign(payload) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);

    const updated = db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'premium');
    assert.strictEqual(updated.is_premium, 1);

    const coupon = db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('WEBHOOK1');
    assert.strictEqual(coupon.uses_count, 1);
  } finally {
    server.close();
  }
});

test('webhook rejects a request with an invalid signature', async () => {
  const payload = JSON.stringify({ event_type: 'transaction.completed', data: {} });
  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/paddle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': 'ts=1;h1=deadbeef' },
      body: payload,
    });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('webhook ignores event types other than transaction.completed', async () => {
  const user = makeUser('webhook-ignore@test.local', 'free');
  const payload = JSON.stringify({
    event_type: 'transaction.created',
    data: { custom_data: { userId: user.id, tier: 'elite' } },
  });
  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/paddle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': sign(payload) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);
    const unchanged = db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
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
  const user = makeUser('checkout-badtier@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + issueToken(user) },
      body: JSON.stringify({ tier: 'free' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('checkout/transaction rejects an invalid coupon before calling Paddle', async () => {
  const user = makeUser('checkout-badcoupon@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + issueToken(user) },
      body: JSON.stringify({ tier: 'premium', couponCode: 'DOES-NOT-EXIST' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid coupon/i);
  } finally {
    server.close();
  }
});
