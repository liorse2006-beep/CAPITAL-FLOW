// server/services/whop.js, the webhook receiver, and the checkout
// transaction-creation endpoint. Sets Whop env vars before requiring
// anything that reads config — node:test runs each file in its own
// process, so this doesn't leak into other test files.
process.env.WHOP_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.WHOP_API_KEY = 'test-api-key';
process.env.WHOP_PREMIUM_PLAN_ID = 'plan_premium_test';
process.env.WHOP_ELITE_PLAN_ID = 'plan_elite_test';
process.env.WHOP_ELITE_UPGRADE_PLAN_ID = 'plan_elite_upgrade_test';

require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const express = require('express');

const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const whop = require('../server/services/whop');
const email = require('../server/services/email');
const webhooksRouter = require('../server/routes/webhooks');
const checkoutRouter = require('../server/routes/checkout');
const adminRouter = require('../server/routes/admin');

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

function startAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

// checkToken only accepts a JWT belonging to ADMIN_EMAIL ('admin@test.local',
// set in testEnv) — mirrors the same helper in test/dbBackup.test.js.
async function getAdminToken() {
  let adminUser = await db.prepare('SELECT * FROM users WHERE email = ?').get('admin@test.local');
  if (!adminUser) {
    const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('admin@test.local');
    adminUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  return issueToken(adminUser);
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

test('payment_succeeded emails the admin and logs a self_service_upgrade audit entry', async (t) => {
  const alertCalls = [];
  t.mock.method(email, 'sendAdminUpgradeAlert', async (...args) => {
    alertCalls.push(args);
  });

  const user = await makeUser('webhook-alert@test.local', 'free');
  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: { metadata: { userId: user.id, tier: 'elite' } },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_alert_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);

    // The async email send is fire-and-forget from the route's perspective
    // (doesn't block the webhook response) — give its microtask a tick.
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(alertCalls.length, 1);
    assert.deepStrictEqual(alertCalls[0], ['webhook-alert@test.local', 'elite']);

    const audit = await db
      .prepare("SELECT * FROM admin_audit_log WHERE action = 'self_service_upgrade' AND target_user_id = ?")
      .get(user.id);
    assert.ok(audit, 'self-service upgrade must appear in the audit log');
    assert.strictEqual(audit.detail, 'elite');
    assert.strictEqual(audit.actor, 'whop-webhook');
  } finally {
    server.close();
  }
});

test('payment_succeeded records the correct price on the revenue ledger, including the discounted eliteUpgrade price', async () => {
  const premiumBuyer = await makeUser('ledger-premium@test.local', 'free');
  const upgradeBuyer = await makeUser('ledger-upgrade@test.local', 'premium');

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const premiumPayload = JSON.stringify({
      type: 'payment_succeeded',
      data: { metadata: { userId: premiumBuyer.id, tier: 'premium' } },
    });
    let res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(premiumPayload, { id: 'wh_ledger_premium' }) },
      body: premiumPayload,
    });
    assert.strictEqual(res.status, 200);

    const upgradePayload = JSON.stringify({
      type: 'payment_succeeded',
      data: { metadata: { userId: upgradeBuyer.id, tier: 'elite', isUpgrade: true } },
    });
    res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(upgradePayload, { id: 'wh_ledger_upgrade' }) },
      body: upgradePayload,
    });
    assert.strictEqual(res.status, 200);

    const premiumEntry = await db
      .prepare("SELECT * FROM payment_events WHERE user_id = ? AND event_type = 'purchase'")
      .get(premiumBuyer.id);
    assert.strictEqual(premiumEntry.amount_cents, 1490, 'a normal Premium purchase must record the full price');

    const upgradeEntry = await db
      .prepare("SELECT * FROM payment_events WHERE user_id = ? AND event_type = 'purchase'")
      .get(upgradeBuyer.id);
    assert.strictEqual(upgradeEntry.amount_cents, 1495, 'the discounted eliteUpgrade offer must record its own price, not the normal $29.90 Elite price');
  } finally {
    server.close();
  }
});

test('payment_refunded records a matching negative ledger entry', async () => {
  const user = await makeUser('ledger-refund@test.local', 'free');
  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const purchasePayload = JSON.stringify({
      type: 'payment_succeeded',
      data: { metadata: { userId: user.id, tier: 'elite' } },
    });
    await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(purchasePayload, { id: 'wh_ledger_refund_purchase' }) },
      body: purchasePayload,
    });

    const refundPayload = JSON.stringify({
      type: 'payment_refunded',
      data: { metadata: { userId: user.id, tier: 'elite' } },
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(refundPayload, { id: 'wh_ledger_refund' }) },
      body: refundPayload,
    });
    assert.strictEqual(res.status, 200);

    // The refund handler updates the ledger asynchronously (fire-and-forget,
    // same pattern as the audit log entry) — give it a tick to land.
    await new Promise((resolve) => setImmediate(resolve));

    const refundEntry = await db
      .prepare("SELECT * FROM payment_events WHERE user_id = ? AND event_type = 'refund'")
      .get(user.id);
    assert.ok(refundEntry, 'a refund must appear on the ledger');
    assert.strictEqual(refundEntry.amount_cents, -2990, 'must refund exactly what the matching purchase recorded');
  } finally {
    server.close();
  }
});

test('GET /admin/api/revenue aggregates the ledger into totals and a recent list', async () => {
  const user = await makeUser('ledger-admin-view@test.local', 'free');
  const webhookServer = await startWebhookApp();
  const webhookPort = webhookServer.address().port;
  try {
    const payload = JSON.stringify({
      type: 'payment_succeeded',
      data: { metadata: { userId: user.id, tier: 'premium' } },
    });
    await fetch(`http://127.0.0.1:${webhookPort}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_ledger_admin_view' }) },
      body: payload,
    });
  } finally {
    webhookServer.close();
  }

  const token = await getAdminToken();
  const adminServer = await startAdminApp();
  const adminPort = adminServer.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${adminPort}/admin/api/revenue`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.thisMonthCents >= 1490, 'this purchase must be counted in this month\'s total');
    assert.ok(body.allTimeCents >= 1490);
    assert.ok(Array.isArray(body.recent) && body.recent.length > 0);
    const entry = body.recent.find((r) => r.email === 'ledger-admin-view@test.local');
    assert.ok(entry, 'the recent purchase must appear in the transaction list');
    assert.strictEqual(entry.amount_cents, 1490);
  } finally {
    adminServer.close();
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

test('payment_refunded downgrades the user whose current tier matches the refunded payment', async () => {
  const user = await makeUser('webhook-refund@test.local', 'elite');
  await db.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(user.id);

  const payload = JSON.stringify({
    type: 'payment_refunded',
    data: { metadata: { userId: user.id, tier: 'elite' } },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_refund_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);

    const updated = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'free', 'refunded tier must be revoked');
    assert.strictEqual(updated.is_premium, 0);

    const audit = await db
      .prepare("SELECT * FROM admin_audit_log WHERE action = 'refund_downgrade' AND target_user_id = ?")
      .get(user.id);
    assert.ok(audit, 'refund downgrade must appear in the audit log');
  } finally {
    server.close();
  }
});

test('refunding an old premium payment does NOT strip a user who since upgraded to elite', async () => {
  const user = await makeUser('webhook-refund-upgraded@test.local', 'elite');

  const payload = JSON.stringify({
    type: 'payment_refunded',
    data: { metadata: { userId: user.id, tier: 'premium' } },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_refund_2' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);
    const unchanged = await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(unchanged.tier, 'elite', 'the elite they still paid for must survive');
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

// ── POST /api/checkout/transaction — tier:'eliteUpgrade' ────────────────────
// The one-time, half-price Elite upgrade offered on the Premium welcome
// screen. The exclusivity has to be enforced server-side (only a CURRENTLY
// Premium account may start it), not just claimed in the frontend copy.

test('eliteUpgrade is rejected for an account that is not currently Premium', async () => {
  const free = await makeUser('checkout-upgrade-free@test.local', 'free');
  const elite = await makeUser('checkout-upgrade-elite@test.local', 'elite');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    for (const user of [free, elite]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) },
        body: JSON.stringify({ tier: 'eliteUpgrade' }),
      });
      assert.strictEqual(res.status, 403, `tier=${user.tier} must be rejected`);
    }
  } finally {
    server.close();
  }
});

test('eliteUpgrade creates a checkout session on the upgrade plan, granting elite once paid', async (t) => {
  const captured = [];
  t.mock.method(whop, 'createCheckoutSession', async (args) => {
    captured.push(args);
    return { purchase_url: 'https://whop.com/checkout/plan_elite_upgrade_test/?session=ch_upgrade' };
  });

  const user = await makeUser('checkout-upgrade-premium@test.local', 'premium');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) },
      body: JSON.stringify({ tier: 'eliteUpgrade' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.purchaseUrl, 'https://whop.com/checkout/plan_elite_upgrade_test/?session=ch_upgrade');

    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].planId, 'plan_elite_upgrade_test', 'must charge the discounted plan, not the normal Elite plan');
    assert.strictEqual(captured[0].metadata.tier, 'elite', 'must still grant the real elite tier once paid');
    assert.strictEqual(captured[0].metadata.userId, String(user.id));
  } finally {
    server.close();
  }
});
