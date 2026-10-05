// server/services/whop.js, the webhook receiver, and the checkout
// transaction-creation endpoint. Sets Whop env vars before requiring
// anything that reads config — node:test runs each file in its own
// process, so this doesn't leak into other test files.
process.env.WHOP_WEBHOOK_SECRET = 'test-webhook-secret';
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
const { resolveToken, invalidateUserEntitlement } = require('../server/middleware/authMiddleware');
const whop = require('../server/services/whop');
const email = require('../server/services/email');
const webhooksRouter = require('../server/routes/webhooks');
const checkoutRouter = require('../server/routes/checkout');

before(async () => {
  assert.strictEqual(process.env.DATABASE_URL, '', 'Whop tests must not inherit an application database URL');
  assert.match(process.env.TURSO_DB_URL, /^file:/, 'Whop tests must use a local temporary SQLite database');
  assert.strictEqual(process.env.TURSO_DB_URL, process.env.CAPITAL_FLOW_TEST_DATABASE_URL);
  await db.ready;
  const processedEventsTable = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('processed_webhook_events');
  assert.ok(processedEventsTable, 'webhook idempotency table must be initialized before webhook tests');
  const paymentEntitlementsTable = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('whop_payment_entitlements');
  assert.ok(paymentEntitlementsTable, 'Whop payment mapping table must be initialized before webhook tests');
});

function sign(
  rawBody,
  { id = 'wh_test_id', ts = String(Math.floor(Date.now() / 1000)), secret = 'test-webhook-secret' } = {}
) {
  const sig = crypto.createHmac('sha256', secret).update(`${id}.${ts}.${rawBody}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

function paymentData(userId, tier, extra = {}) {
  const planId = tier === 'premium' ? 'plan_premium_test' : 'plan_elite_test';
  const { promo_code: providerPromoCode, paymentId = `pay_test_${userId}`, ...metadataExtra } = extra;
  return {
    id: paymentId,
    plan: { id: planId },
    ...(providerPromoCode ? { promo_code: providerPromoCode } : {}),
    metadata: whop.createCheckoutMetadata({
      userId: String(userId),
      tier,
      couponCode: metadataExtra.couponCode || '',
    }),
  };
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

test('entitlement invalidation refreshes every cached session without revoking sessions', async () => {
  const user = await makeUser('entitlement-cache@test.local', 'free');
  const session = await issueToken(user);
  const cachedFree = await resolveToken(session.accessToken);
  assert.strictEqual(cachedFree.tier, 'free');

  await db.prepare("UPDATE users SET tier = 'premium', is_premium = 1 WHERE id = ?").run(user.id);
  invalidateUserEntitlement(user.id);
  const upgraded = await resolveToken(session.accessToken);
  assert.strictEqual(upgraded.tier, 'premium');

  await db.prepare("UPDATE users SET tier = 'free', is_premium = 0 WHERE id = ?").run(user.id);
  invalidateUserEntitlement(user.id);
  const downgraded = await resolveToken(session.accessToken);
  assert.strictEqual(downgraded.tier, 'free');
  const sessions = await db.prepare('SELECT id FROM user_sessions WHERE user_id = ?').all(user.id);
  assert.strictEqual(sessions.length, 1, 'entitlement invalidation must not revoke the device session');
});

// ── whop.verifyWebhookSignature ────────────────────────────────────────────

test('verifyWebhookSignature accepts a correctly signed body', () => {
  const body = JSON.stringify({ type: 'payment_succeeded' });
  assert.strictEqual(whop.verifyWebhookSignature(body, sign(body)), true);
});

test('verifyWebhookSignature preserves raw bytes and accepts a valid signature among multiple entries', () => {
  const body = Buffer.from('{"type":"payment.succeeded","note":"שלום"}', 'utf8');
  const primary = sign(body.toString('utf8'), { id: 'wh_raw_bytes' });
  const rotated = sign(body.toString('utf8'), { id: 'wh_raw_bytes', secret: 'old-secret' });
  const headers = {
    'Webhook-ID': primary['webhook-id'],
    'Webhook-Timestamp': primary['webhook-timestamp'],
    'Webhook-Signature': `${rotated['webhook-signature']} ${primary['webhook-signature']}`,
  };
  assert.strictEqual(whop.verifyWebhookSignature(body, headers), true);
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

test('verifyWebhookSignature rejects a correctly-signed but stale (replayed) timestamp', () => {
  const body = JSON.stringify({ type: 'payment_succeeded' });
  const staleTs = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 minutes old
  assert.strictEqual(whop.verifyWebhookSignature(body, sign(body, { ts: staleTs })), false);
});

test('verifyWebhookSignature rejects a non-numeric timestamp', () => {
  const body = JSON.stringify({ type: 'payment_succeeded' });
  assert.strictEqual(whop.verifyWebhookSignature(body, sign(body, { ts: 'not-a-number' })), false);
});

test('verifyWebhookSignature rejects a malformed signature header', () => {
  assert.strictEqual(
    whop.verifyWebhookSignature('{}', {
      'webhook-id': 'x',
      'webhook-timestamp': '1',
      'webhook-signature': 'not-valid',
    }),
    false
  );
});

// ── POST /api/webhooks/whop ─────────────────────────────────────────────────

test('webhook upgrades the user tier on payment_succeeded and redeems the coupon', async () => {
  const user = await makeUser('webhook-upgrade@test.local', 'free');
  await db
    .prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)')
    .run('WEBHOOK1', 20, 'both', 0);

  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(user.id, 'premium', { couponCode: 'WEBHOOK1', promo_code: { code: 'WEBHOOK1' } }),
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

test('webhook does not redeem a requested coupon when Whop did not confirm the promo', async () => {
  const user = await makeUser('webhook-no-promo-confirmation@test.local', 'free');
  await db
    .prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)')
    .run('WEBHOOKNO', 20, 'both', 0);

  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(user.id, 'premium', { couponCode: 'WEBHOOKNO' }),
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_no_promo_confirmation_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);

    const updated = await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'premium');
    const coupon = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('WEBHOOKNO');
    assert.strictEqual(coupon.uses_count, 0, 'a full-price payment must not consume a local promo use');
  } finally {
    server.close();
  }
});

test('webhook refuses to grant access when the signed payment plan is missing or mismatched', async () => {
  const user = await makeUser('webhook-plan-mismatch@test.local', 'free');
  const payload = JSON.stringify({
    type: 'payment.succeeded',
    data: {
      plan: { id: 'plan_not_configured' },
      metadata: whop.createCheckoutMetadata({ userId: String(user.id), tier: 'elite' }),
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_plan_mismatch_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 422);
    const unchanged = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.deepStrictEqual(unchanged, { tier: 'free', is_premium: 0 });
  } finally {
    server.close();
  }
});

test('webhook refuses Elements metadata tampered with after the server signed it', async () => {
  const attacker = await makeUser('webhook-metadata-attacker@test.local', 'free');
  const victim = await makeUser('webhook-metadata-victim@test.local', 'free');
  const data = paymentData(attacker.id, 'premium');
  data.metadata.userId = String(victim.id);
  const payload = JSON.stringify({ type: 'payment.succeeded', data });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_metadata_tamper_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 422);
    assert.deepStrictEqual(await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(victim.id), {
      tier: 'free',
      is_premium: 0,
    });
    assert.deepStrictEqual(await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(attacker.id), {
      tier: 'free',
      is_premium: 0,
    });
  } finally {
    server.close();
  }
});

test('webhook refuses unsigned legacy/client-created checkout metadata', async () => {
  const victim = await makeUser('webhook-metadata-unsigned@test.local', 'free');
  const payload = JSON.stringify({
    type: 'payment.succeeded',
    data: {
      plan: { id: 'plan_premium_test' },
      metadata: { userId: String(victim.id), tier: 'premium' },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_metadata_unsigned_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 422);
    assert.deepStrictEqual(await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(victim.id), {
      tier: 'free',
      is_premium: 0,
    });
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
    data: paymentData(user.id, 'elite'),
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

test('webhook redelivery with the same webhook-id does not double-redeem the coupon', async () => {
  const user = await makeUser('webhook-redelivery@test.local', 'free');
  await db
    .prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)')
    .run('WEBHOOK2', 20, 'both', 0);

  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(user.id, 'premium', { couponCode: 'WEBHOOK2', promo_code: { code: 'WEBHOOK2' } }),
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

test('a webhook event claimed but never completed (process killed mid-deploy) is retried, not dropped as a duplicate', async () => {
  // Regression: a deploy that kills the process AFTER the idempotency
  // INSERT commits but BEFORE handleWhopEvent finishes leaves a stuck claim
  // row behind. Whop's retry of the same event used to see the row exists
  // and immediately return { duplicate: true } — silently discarding a paid
  // upgrade forever, with no error anywhere. Simulate that exact stuck
  // state directly (INSERT the claim with completed_at left NULL, as if
  // the process died right after claiming) and confirm the next delivery
  // of that same webhook-id actually finishes the job instead of skipping it.
  const user = await makeUser('webhook-stuckclaim@test.local', 'free');
  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(user.id, 'elite'),
  });
  const headers = sign(payload, { id: 'wh_stuck_claim_1' });

  await db
    .prepare('INSERT INTO processed_webhook_events (event_id, processed_at, completed_at) VALUES (?, ?, NULL)')
    .run('wh_stuck_claim_1', Math.floor(Date.now() / 1000) - 120);

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.notStrictEqual(body.duplicate, true, 'a never-completed claim must be retried, not treated as a duplicate');

    const updated = await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'elite', 'the upgrade the stuck claim was carrying must actually land');

    const row = await db
      .prepare('SELECT completed_at FROM processed_webhook_events WHERE event_id = ?')
      .get('wh_stuck_claim_1');
    assert.ok(row.completed_at, 'completed_at must now be set, so a genuine future duplicate IS skipped');

    // A true duplicate delivery after completion must now be skipped.
    const redelivery = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload,
    });
    const redeliveryBody = await redelivery.json();
    assert.strictEqual(redeliveryBody.duplicate, true);
  } finally {
    server.close();
  }
});

test('two concurrent retries of the same stuck (never-completed) claim only run the business logic once', async () => {
  const user = await makeUser('webhook-stuckrace@test.local', 'free');
  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(user.id, 'elite'),
  });
  const headers = sign(payload, { id: 'wh_stuck_race_1' });

  await db
    .prepare('INSERT INTO processed_webhook_events (event_id, processed_at, completed_at) VALUES (?, ?, NULL)')
    .run('wh_stuck_race_1', Math.floor(Date.now() / 1000) - 120);

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const send = () =>
      fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: payload,
      });
    const [r1, r2] = await Promise.all([send(), send()]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    const duplicateFlags = [b1.duplicate === true, b2.duplicate === true];
    assert.deepStrictEqual(
      duplicateFlags.sort(),
      [false, true],
      'exactly one concurrent retry must win the claim, the other must see duplicate'
    );
  } finally {
    server.close();
  }
});

test('two truly concurrent deliveries of the same webhook-id only redeem the coupon once', async () => {
  // Regression for the idempotency TOCTOU: the old check-then-insert-at-the-
  // end logic let two overlapping requests both pass the "already processed"
  // check before either had recorded it. Firing both requests via Promise.all
  // (not sequentially, like the test above) actually exercises that race —
  // exactly one must claim the event and redeem the coupon.
  const user = await makeUser('webhook-concurrent@test.local', 'free');
  await db
    .prepare('INSERT INTO coupons (code, discount_percent, applies_to, uses_count) VALUES (?, ?, ?, ?)')
    .run('WEBHOOKRACE', 20, 'both', 0);

  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(user.id, 'premium', { couponCode: 'WEBHOOKRACE', promo_code: { code: 'WEBHOOKRACE' } }),
  });
  const headers = sign(payload, { id: 'wh_concurrent_test_1' });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const send = () =>
      fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: payload,
      });

    const [first, second] = await Promise.all([send(), send()]);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 200);
    const bodies = await Promise.all([first.json(), second.json()]);
    const duplicateCount = bodies.filter((b) => b.duplicate).length;
    assert.strictEqual(
      duplicateCount,
      1,
      'exactly one of the two concurrent deliveries must be told it was a duplicate'
    );

    const coupon = await db.prepare('SELECT uses_count FROM coupons WHERE code = ?').get('WEBHOOKRACE');
    assert.strictEqual(coupon.uses_count, 1, 'the coupon must be redeemed exactly once, not twice');
  } finally {
    server.close();
  }
});

test('payment_succeeded for a user that no longer exists alerts the admin instead of crashing or granting nothing silently', async (t) => {
  const alertCalls = [];
  t.mock.method(email, 'sendAdminUpgradeAlert', async (...args) => {
    alertCalls.push(args);
  });

  const deletedUserId = 999999999; // never inserted — simulates the account being deleted before delivery
  const payload = JSON.stringify({
    type: 'payment_succeeded',
    data: paymentData(deletedUserId, 'elite'),
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_missing_user_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 200, 'must not 500 just because the account is gone');

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(alertCalls.length, 1, 'the admin must be alerted');
    assert.match(alertCalls[0][1], /PAYMENT SUCCEEDED BUT ACCOUNT MISSING/);

    const audit = await db
      .prepare("SELECT * FROM admin_audit_log WHERE action = 'payment_for_missing_user' AND target_user_id = ?")
      .get(deletedUserId);
    assert.ok(audit, 'must leave an audit trail for manual follow-up');
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
    data: paymentData(user.id, 'elite'),
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

test('refund.created downgrades the user whose current tier matches the refunded payment', async () => {
  const user = await makeUser('webhook-refund@test.local', 'free');
  const paymentPayload = JSON.stringify({
    type: 'payment.succeeded',
    data: paymentData(user.id, 'elite'),
  });

  const refundPayload = JSON.stringify({
    type: 'refund.created',
    data: {
      id: 'rf_test_refund',
      status: 'succeeded',
      payment: paymentData(user.id, 'elite'),
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const paymentRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(paymentPayload, { id: 'wh_refund_payment_1' }) },
      body: paymentPayload,
    });
    assert.strictEqual(paymentRes.status, 200);

    const refundRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(refundPayload, { id: 'wh_refund_1' }) },
      body: refundPayload,
    });
    assert.strictEqual(refundRes.status, 200);

    const updated = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'free', 'refunded tier must be revoked');
    assert.strictEqual(updated.is_premium, 0);

    const entitlement = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(`pay_test_${user.id}`);
    assert.strictEqual(entitlement.status, 'refunded');

    const audit = await db
      .prepare("SELECT * FROM admin_audit_log WHERE action = 'refund_downgrade' AND target_user_id = ?")
      .get(user.id);
    assert.ok(audit, 'refund downgrade must appear in the audit log');
  } finally {
    server.close();
  }
});

test('refund.updated revokes access only after Whop confirms the refund succeeded', async () => {
  const user = await makeUser('webhook-refund-updated@test.local', 'free');
  const paymentId = `pay_test_${user.id}`;
  const paymentPayload = JSON.stringify({ type: 'payment.succeeded', data: paymentData(user.id, 'elite') });
  const pendingPayload = JSON.stringify({
    type: 'refund.created',
    data: {
      id: 'rf_test_pending',
      status: 'pending',
      payment: { id: paymentId, plan: { id: 'plan_elite_test' } },
    },
  });
  const succeededPayload = JSON.stringify({
    type: 'refund.updated',
    data: {
      id: 'rf_test_pending',
      status: 'succeeded',
      payment: { id: paymentId, plan: { id: 'plan_elite_test' } },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const paymentRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(paymentPayload, { id: 'wh_refund_update_payment' }) },
      body: paymentPayload,
    });
    assert.strictEqual(paymentRes.status, 200);

    const pendingRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(pendingPayload, { id: 'wh_refund_pending' }) },
      body: pendingPayload,
    });
    assert.strictEqual(pendingRes.status, 200);
    let state = await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(state.tier, 'elite', 'pending refund must not revoke paid access');

    const succeededRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(succeededPayload, { id: 'wh_refund_succeeded' }) },
      body: succeededPayload,
    });
    assert.strictEqual(succeededRes.status, 200);
    state = await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(state.tier, 'free', 'succeeded refund must revoke its paid tier');
    const entitlement = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(paymentId);
    assert.strictEqual(entitlement.status, 'refunded');
  } finally {
    server.close();
  }
});

test('dispute.created resolves the account from its nested payment ID when metadata is omitted', async () => {
  const user = await makeUser('webhook-dispute@test.local', 'free');
  const paymentId = `pay_test_${user.id}`;
  const paymentPayload = JSON.stringify({
    type: 'payment.succeeded',
    data: paymentData(user.id, 'elite'),
  });
  // Whop dispute payloads identify the charge but need not repeat checkout metadata.
  const disputePayload = JSON.stringify({
    type: 'dispute.created',
    data: {
      id: 'dspt_test_dispute',
      plan: { id: 'plan_elite_test' },
      payment: { id: paymentId },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const paymentRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(paymentPayload, { id: 'wh_dispute_payment_1' }) },
      body: paymentPayload,
    });
    assert.strictEqual(paymentRes.status, 200);

    const disputeRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(disputePayload, { id: 'wh_dispute_1' }) },
      body: disputePayload,
    });
    assert.strictEqual(disputeRes.status, 200);

    const updated = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'free');
    assert.strictEqual(updated.is_premium, 0);
    const entitlement = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(paymentId);
    assert.strictEqual(entitlement.status, 'disputed');
  } finally {
    server.close();
  }
});

test('dispute.updated restores the verified payment tier only when Whop marks the dispute won', async () => {
  const user = await makeUser('webhook-dispute-won@test.local', 'free');
  const paymentId = `pay_test_${user.id}`;
  const paymentPayload = JSON.stringify({ type: 'payment.succeeded', data: paymentData(user.id, 'elite') });
  const disputePayload = JSON.stringify({
    type: 'dispute.created',
    data: {
      id: 'dspt_test_won',
      status: 'needs_response',
      payment: { id: paymentId },
      plan: { id: 'plan_elite_test' },
    },
  });
  const wonPayload = JSON.stringify({
    type: 'dispute.updated',
    data: {
      id: 'dspt_test_won',
      status: 'won',
      payment: { id: paymentId },
      plan: { id: 'plan_elite_test' },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    for (const [payload, webhookId] of [
      [paymentPayload, 'wh_dispute_won_payment'],
      [disputePayload, 'wh_dispute_won_created'],
      [wonPayload, 'wh_dispute_won_updated'],
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sign(payload, { id: webhookId }) },
        body: payload,
      });
      assert.strictEqual(res.status, 200);
    }

    const restored = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(restored.tier, 'elite');
    assert.strictEqual(restored.is_premium, 1);
    const entitlement = await db
      .prepare('SELECT status, revoked_at, revocation_reason FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(paymentId);
    assert.strictEqual(entitlement.status, 'dispute_won');
    assert.strictEqual(entitlement.revoked_at, null);
    assert.strictEqual(entitlement.revocation_reason, null);
  } finally {
    server.close();
  }
});

test('dispute_alert.created is acknowledged without revoking access before a formal dispute', async () => {
  const user = await makeUser('webhook-dispute-alert@test.local', 'free');
  const paymentId = `pay_test_${user.id}`;
  const paymentPayload = JSON.stringify({ type: 'payment.succeeded', data: paymentData(user.id, 'elite') });
  const alertPayload = JSON.stringify({
    type: 'dispute_alert.created',
    data: {
      id: 'dspt_alert_test',
      payment: { id: paymentId },
      plan: { id: 'plan_elite_test' },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    for (const [payload, webhookId] of [
      [paymentPayload, 'wh_dispute_alert_payment'],
      [alertPayload, 'wh_dispute_alert_created'],
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sign(payload, { id: webhookId }) },
        body: payload,
      });
      assert.strictEqual(res.status, 200);
    }

    const unchanged = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(unchanged.tier, 'elite');
    assert.strictEqual(unchanged.is_premium, 1);
    const entitlement = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(paymentId);
    assert.strictEqual(entitlement.status, 'active');
  } finally {
    server.close();
  }
});

test('out-of-order dispute.updated won cannot be overwritten by a late dispute.created event', async () => {
  const user = await makeUser('webhook-dispute-order@test.local', 'free');
  const paymentId = `pay_test_${user.id}`;
  const paymentPayload = JSON.stringify({ type: 'payment.succeeded', data: paymentData(user.id, 'elite') });
  const wonPayload = JSON.stringify({
    type: 'dispute.updated',
    data: { id: 'dspt_test_order', status: 'won', payment: { id: paymentId }, plan: { id: 'plan_elite_test' } },
  });
  const createdPayload = JSON.stringify({
    type: 'dispute.created',
    data: {
      id: 'dspt_test_order',
      status: 'needs_response',
      payment: { id: paymentId },
      plan: { id: 'plan_elite_test' },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    for (const [payload, webhookId] of [
      [paymentPayload, 'wh_dispute_order_payment'],
      [wonPayload, 'wh_dispute_order_won'],
      [createdPayload, 'wh_dispute_order_created_late'],
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sign(payload, { id: webhookId }) },
        body: payload,
      });
      assert.strictEqual(res.status, 200);
    }

    const unchanged = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(unchanged.tier, 'elite');
    assert.strictEqual(unchanged.is_premium, 1);
    const entitlement = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(paymentId);
    assert.strictEqual(entitlement.status, 'dispute_won');
  } finally {
    server.close();
  }
});

test('unrecorded unsigned reversal metadata cannot revoke an unrelated paid account', async () => {
  const user = await makeUser('webhook-legacy-refund@test.local', 'elite');
  const payload = JSON.stringify({
    type: 'refund.created',
    data: {
      id: 'rf_test_legacy',
      status: 'succeeded',
      payment: {
        id: 'pay_legacy_purchase',
        plan: { id: 'plan_elite_test' },
        metadata: { userId: String(user.id), tier: 'elite' },
      },
    },
  });

  const server = await startWebhookApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_legacy_refund_1' }) },
      body: payload,
    });
    assert.strictEqual(res.status, 200);
    const updated = await db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(updated.tier, 'elite');
    const state = await db
      .prepare('SELECT status FROM whop_payment_dispositions WHERE payment_id = ?')
      .get('pay_legacy_purchase');
    assert.strictEqual(state.status, 'refunded', 'remember the refund without trusting the supplied account identity');
  } finally {
    server.close();
  }
});

test('ledger-backed legacy reversal remains supported without trusted client metadata', async () => {
  const user = await makeUser('webhook-recorded-legacy-refund@test.local', 'elite');
  await db
    .prepare(
      "INSERT INTO whop_payment_entitlements (payment_id, user_id, tier, plan_id, created_at) VALUES (?, ?, 'elite', 'plan_elite_test', ?)"
    )
    .run('pay_recorded_legacy', user.id, Math.floor(Date.now() / 1000));
  const data = {
    id: 'rf_recorded_legacy',
    status: 'succeeded',
    payment: {
      id: 'pay_recorded_legacy',
      plan: { id: 'plan_elite_test' },
      metadata: { userId: '999999', tier: 'elite' },
    },
  };
  await deliverEvents([{ type: 'refund.created', data }], 'recorded-legacy');
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
});

async function deliverEvents(events, label, concurrent = false) {
  const server = await startWebhookApp();
  try {
    const deliver = async (event, index) => {
      const payload = JSON.stringify(event);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sign(payload, { id: `wh_${label}_${index}` }) },
        body: payload,
      });
      assert.equal(response.status, 200, await response.text());
    };
    if (concurrent) await Promise.all(events.map(deliver));
    else for (const [index, event] of events.entries()) await deliver(event, index);
  } finally {
    server.close();
  }
}

async function expectRejectedPayment(data, label) {
  const server = await startWebhookApp();
  try {
    const payload = JSON.stringify({ type: 'payment.succeeded', data });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_' + label }) },
      body: payload,
    });
    assert.equal(response.status, 422);
  } finally {
    server.close();
  }
}

function legacyUpgradeMetadata(userId) {
  const metadata = { userId: String(userId), tier: 'elite', checkoutVersion: 'elements-v1' };
  metadata.metadataSignature = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(JSON.stringify(['capital-flow:whop-checkout', 'elements-v1', String(userId), 'elite', '']))
    .digest('base64url');
  return metadata;
}

test('an unused discounted authorization cannot buy after Premium has been refunded', async (t) => {
  const user = await makeUser('offer-after-premium-refund@test.local');
  const premium = paymentData(user.id, 'premium', { paymentId: 'pay_eligibility_premium' });
  await deliverEvents([{ type: 'payment.succeeded', data: premium }], 'eligibility-premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock + 60000);
  await deliverEvents(
    [{ type: 'refund.updated', data: { status: 'succeeded', payment: { id: premium.id } } }],
    'eligibility-refund'
  );
  t.mock.method(Date, 'now', () => clock + 120000);
  await expectRejectedPayment(
    {
      id: 'pay_after_eligibility',
      plan: { id: metadata.planId },
      created_at: new Date(Date.now()).toISOString(),
      metadata,
    },
    'after-eligibility'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
});

test('a payment made before Premium refund remains valid on delayed delivery', async (t) => {
  const user = await makeUser('offer-before-premium-refund@test.local');
  const premium = paymentData(user.id, 'premium', { paymentId: 'pay_before_eligibility_premium' });
  await deliverEvents([{ type: 'payment.succeeded', data: premium }], 'before-eligibility-premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock + 60000);
  await deliverEvents(
    [{ type: 'refund.updated', data: { status: 'succeeded', payment: { id: premium.id } } }],
    'before-eligibility-refund'
  );
  await deliverEvents(
    [
      {
        type: 'payment.succeeded',
        data: {
          id: 'pay_before_eligibility',
          plan: { id: metadata.planId },
          created_at: new Date(clock).toISOString(),
          metadata,
        },
      },
    ],
    'before-eligibility-delayed'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('issuing another checkout must not delete evidence of an older already-paid checkout', async (t) => {
  const user = await makeUser('offer-evidence-retention@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock + 9 * 86400000);
  await whop.issueUpgradeCheckoutMetadata(user.id);
  await deliverEvents(
    [
      {
        type: 'payment.succeeded',
        data: {
          id: 'pay_retained_evidence',
          plan: { id: metadata.planId },
          created_at: new Date(clock).toISOString(),
          metadata,
        },
      },
    ],
    'retained-evidence'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('a legacy discounted signature cannot be reused for a second payment', async (t) => {
  const user = await makeUser('legacy-offer-one-payment@test.local');
  const premium = paymentData(user.id, 'premium', { paymentId: 'pay_legacy_premium' });
  await deliverEvents([{ type: 'payment.succeeded', data: premium }], 'legacy-premium');
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock + 60000);
  const payment = {
    id: 'pay_legacy_discount_one',
    plan: { id: 'plan_elite_upgrade_test' },
    created_at: new Date(Date.now()).toISOString(),
    metadata: legacyUpgradeMetadata(user.id),
  };
  await deliverEvents(
    [
      { type: 'payment.succeeded', data: payment },
      { type: 'refund.updated', data: { status: 'succeeded', payment: { id: payment.id } } },
    ],
    'legacy-one'
  );
  await expectRejectedPayment({ ...payment, id: 'pay_legacy_discount_two' }, 'legacy-second');
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'premium');
});

test('a legacy discounted payment made while Premium survives a later Premium refund', async (t) => {
  const user = await makeUser('legacy-offer-delayed-refund@test.local');
  const clock = Date.now();
  const premium = paymentData(user.id, 'premium', { paymentId: 'pay_legacy_delayed_premium' });
  premium.created_at = new Date(clock).toISOString();
  await deliverEvents([{ type: 'payment.succeeded', data: premium }], 'legacy-delayed-premium');
  t.mock.method(Date, 'now', () => clock + 120000);
  await deliverEvents(
    [{ type: 'refund.updated', data: { status: 'succeeded', payment: { id: premium.id } } }],
    'legacy-delayed-refund'
  );
  await deliverEvents(
    [
      {
        type: 'payment.succeeded',
        data: {
          id: 'pay_legacy_delayed_discount',
          plan: { id: 'plan_elite_upgrade_test' },
          created_at: new Date(clock + 60000).toISOString(),
          metadata: legacyUpgradeMetadata(user.id),
        },
      },
    ],
    'legacy-delayed-discount'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('signed reversal metadata cannot turn a reused authorization into a verified payment', async () => {
  const user = await makeUser('offer-dispute-replay@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const first = { id: 'pay_dispute_replay_one', plan: { id: metadata.planId }, metadata };
  await deliverEvents(
    [
      { type: 'payment.succeeded', data: first },
      { type: 'refund.updated', data: { status: 'succeeded', payment: { id: first.id } } },
    ],
    'dispute-replay-first'
  );
  const payment = { ...first, id: 'pay_dispute_replay_two' };
  await deliverEvents(
    [
      { type: 'dispute.created', data: { status: 'under_review', payment } },
      { type: 'dispute.updated', data: { status: 'won', payment } },
    ],
    'dispute-replay-second'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
});

test('legacy numeric provider timestamps stay usable without accepting malformed timestamps', async () => {
  const user = await makeUser('offer-numeric-timestamp@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const payment = {
    id: 'pay_numeric_timestamp',
    plan: { id: metadata.planId },
    created_at: Math.floor(Date.now() / 1000),
    metadata,
  };
  await deliverEvents([{ type: 'payment.succeeded', data: payment }], 'numeric-timestamp');
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('the timestamp gate rejects malformed, future and ambiguous provider values', async () => {
  const user = await makeUser('offer-malformed-timestamps@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  for (const [index, created_at] of [
    true,
    'not-a-date',
    '',
    '10/04/2026',
    Date.now(),
    Math.floor(Date.now() / 1000) + 600,
  ].entries()) {
    await expectRejectedPayment(
      { id: 'pay_invalid_time_' + index, plan: { id: metadata.planId }, created_at, metadata },
      'invalid-time-' + index
    );
  }
});

test('a paid checkout preceding revocation within the same second is not rejected', async (t) => {
  const user = await makeUser('offer-same-second@test.local');
  const clock = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, 'now', () => clock + 200);
  const premium = paymentData(user.id, 'premium', { paymentId: 'pay_same_second_premium' });
  await deliverEvents([{ type: 'payment.succeeded', data: premium }], 'same-second-premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  t.mock.method(Date, 'now', () => clock + 700);
  await deliverEvents(
    [{ type: 'refund.updated', data: { status: 'succeeded', payment: { id: premium.id } } }],
    'same-second-refund'
  );
  await deliverEvents(
    [
      {
        type: 'payment.succeeded',
        data: {
          id: 'pay_same_second_upgrade',
          plan: { id: metadata.planId },
          paid_at: new Date(clock + 250).toISOString(),
          metadata,
        },
      },
    ],
    'same-second-upgrade'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('a discounted authorization cannot be reused for a second payment after refund', async () => {
  const user = await makeUser('whop-offer-reuse@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const payment = { id: 'pay_offer_first', plan: { id: metadata.planId }, metadata };
  await deliverEvents(
    [
      { type: 'payment.succeeded', data: payment },
      { type: 'refund.updated', data: { status: 'succeeded', payment: { id: payment.id } } },
    ],
    'offer-first-refunded'
  );
  await expectRejectedPayment({ ...payment, id: 'pay_offer_second' }, 'offer-reused');
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
});

test('a delayed webhook remains valid if the provider payment was created during its authorization window', async (t) => {
  const user = await makeUser('whop-offer-delayed@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const createdAt = new Date().toISOString();
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock + 2 * 86400000);
  await deliverEvents(
    [
      {
        type: 'payment.succeeded',
        data: { id: 'pay_offer_delayed', plan: { id: metadata.planId }, created_at: createdAt, metadata },
      },
    ],
    'offer-delayed'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('a new payment created after the discounted authorization expires is rejected', async (t) => {
  const user = await makeUser('whop-offer-expired@test.local', 'premium');
  const metadata = await whop.issueUpgradeCheckoutMetadata(user.id);
  const clock = Date.now();
  t.mock.method(Date, 'now', () => clock + 2 * 86400000);
  await expectRejectedPayment(
    {
      id: 'pay_offer_expired',
      plan: { id: metadata.planId },
      created_at: new Date(clock + 2 * 86400000).toISOString(),
      metadata,
    },
    'offer-expired'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'premium');
});

test('optional mismatched metadata cannot erase a refund tombstone for an unrecorded payment', async () => {
  const user = await makeUser('whop-reversal-metadata-conflict@test.local');
  const metadata = whop.createCheckoutMetadata({ userId: user.id, tier: 'elite' });
  await deliverEvents(
    [
      {
        type: 'refund.updated',
        data: {
          status: 'succeeded',
          payment: { id: 'pay_unknown_conflict', plan: { id: 'plan_elite_upgrade_test' }, metadata },
        },
      },
    ],
    'reversal-conflict'
  );
  assert.equal(
    (await db.prepare('SELECT status FROM whop_payment_dispositions WHERE payment_id = ?').get('pay_unknown_conflict'))
      .status,
    'refunded'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
});

test('a won dispute with signed metadata alone cannot grant an unverified payment', async () => {
  const user = await makeUser('whop-won-without-success@test.local');
  const payment = paymentData(user.id, 'elite', { paymentId: 'pay_won_without_success' });
  await deliverEvents([{ type: 'dispute.updated', data: { status: 'won', payment } }], 'won-no-success');
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
  assert.equal(
    await db.prepare('SELECT payment_id FROM whop_payment_entitlements WHERE payment_id = ?').get(payment.id),
    undefined
  );
});

for (const status of ['refunded', 'disputed', 'dispute_won']) {
  test(`${status} arriving before payment success is remembered without granting from a reversal`, async () => {
    const user = await makeUser(`webhook-before-${status}@test.local`);
    const payment = paymentData(user.id, 'elite');
    const reversal = {
      type: status === 'refunded' ? 'refund.updated' : 'dispute.updated',
      data: {
        id: `event_${status}`,
        status: status === 'refunded' ? 'succeeded' : status === 'dispute_won' ? 'won' : 'under_review',
        payment: { id: payment.id },
        plan: payment.plan,
      },
    };
    await deliverEvents([reversal], `before-${status}`);
    assert.equal(
      (await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier,
      'free',
      'a reversal is not proof of a fulfilled payment'
    );
    await deliverEvents([{ type: 'payment.succeeded', data: payment }], `after-${status}`);
    assert.equal(
      (await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier,
      status === 'dispute_won' ? 'elite' : 'free'
    );
    const record = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(payment.id);
    assert.equal(record.status, status);
  });
}

test('concurrent distinct success and refund event IDs leave a terminal refunded entitlement', async () => {
  const user = await makeUser('webhook-refund-success-concurrent@test.local');
  const payment = paymentData(user.id, 'elite');
  await deliverEvents(
    [
      { type: 'payment.succeeded', data: payment },
      { type: 'refund.updated', data: { status: 'succeeded', payment: { id: payment.id }, plan: payment.plan } },
    ],
    'concurrent-refund-success',
    true
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
  assert.equal(
    (await db.prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?').get(payment.id)).status,
    'refunded'
  );
});

test('refunding one purchase preserves another active same-tier purchase', async () => {
  const user = await makeUser('webhook-sibling-purchase@test.local');
  const one = paymentData(user.id, 'elite', { paymentId: 'pay_sibling_one' });
  const two = paymentData(user.id, 'elite', { paymentId: 'pay_sibling_two' });
  await deliverEvents(
    [
      { type: 'payment.succeeded', data: one },
      { type: 'payment.succeeded', data: two },
      { type: 'refund.updated', data: { status: 'succeeded', payment: { id: one.id }, plan: one.plan } },
    ],
    'sibling-purchase'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('metadata issued for the regular Elite plan cannot authorize a discounted plan', async () => {
  const user = await makeUser('webhook-plan-bound@test.local');
  const data = paymentData(user.id, 'elite');
  data.plan = { id: 'plan_elite_upgrade_test' };
  const payload = JSON.stringify({ type: 'payment.succeeded', data });
  const server = await startWebhookApp();
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(payload, { id: 'wh_plan_bound' }) },
      body: payload,
    });
    assert.equal(response.status, 422);
    assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'free');
  } finally {
    server.close();
  }
});

test('an eligible discounted checkout grants Elite even if a later downgrade precedes the webhook', async () => {
  const user = await makeUser('webhook-eligible-offer@test.local', 'premium');
  const checkoutServer = await startCheckoutApp();
  let checkout;
  try {
    const response = await fetch(`http://127.0.0.1:${checkoutServer.address().port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
      body: JSON.stringify({ tier: 'eliteUpgrade' }),
    });
    assert.equal(response.status, 200);
    checkout = await response.json();
  } finally {
    checkoutServer.close();
  }
  assert.equal(checkout.metadata.planId, checkout.planId);
  const paidAt = new Date().toISOString();
  await db.prepare("UPDATE users SET tier = 'free' WHERE id = ?").run(user.id);
  await deliverEvents(
    [
      {
        type: 'payment.succeeded',
        data: {
          id: 'pay_eligible_discount',
          plan: { id: checkout.planId },
          paid_at: paidAt,
          metadata: checkout.metadata,
        },
      },
    ],
    'eligible-discount'
  );
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier, 'elite');
});

test('refunding an old premium payment does NOT strip a user who since upgraded to elite', async () => {
  const user = await makeUser('webhook-refund-upgraded@test.local', 'elite');

  const payload = JSON.stringify({
    type: 'payment_refunded',
    data: paymentData(user.id, 'premium'),
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
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
      body: JSON.stringify({ tier: 'free' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('checkout/transaction rejects a malformed promo code before calling Whop', async () => {
  const user = await makeUser('checkout-badcoupon@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
      body: JSON.stringify({ tier: 'premium', couponCode: 'not valid!' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /format/i);
  } finally {
    server.close();
  }
});

test('checkout/transaction returns an allowlisted plan and signed Elements metadata for provider promos', async () => {
  const user = await makeUser('checkout-providerpromo@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
      body: JSON.stringify({ tier: 'premium', couponCode: 'provider-only-25' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.couponCode, 'PROVIDER-ONLY-25');
    assert.strictEqual(body.discountPercent, undefined);
    assert.strictEqual(body.planId, 'plan_premium_test');
    assert.strictEqual(body.tier, 'premium');
    assert.strictEqual(body.metadata.couponCode, 'PROVIDER-ONLY-25');
    assert.strictEqual(body.metadata.userId, String(user.id));
    assert.strictEqual(whop.verifyCheckoutMetadata(body.metadata), true);
    assert.strictEqual(body.sessionId, undefined, 'the browser-side Elements SDK creates the checkout session');
    assert.strictEqual(body.purchaseUrl, undefined, 'Elements does not use the legacy hosted checkout URL');
  } finally {
    server.close();
  }
});

test('checkout/transaction signs the exact local coupon metadata without calculating a price', async () => {
  await db
    .prepare('INSERT INTO coupons (code, discount_percent, applies_to) VALUES (?, ?, ?)')
    .run('ATTACHTEST', 25, 'both');
  const user = await makeUser('checkout-couponattach@test.local');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
      body: JSON.stringify({ tier: 'premium', couponCode: 'attachtest' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.couponCode, 'ATTACHTEST');
    assert.strictEqual(body.discountPercent, undefined);
    assert.strictEqual(body.metadata.couponCode, 'ATTACHTEST');
    assert.strictEqual(whop.verifyCheckoutMetadata(body.metadata), true);
  } finally {
    server.close();
  }
});

test('checkout/transaction debounces a rapid double-submit', async () => {
  const user = await makeUser('checkout-doubleclick@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const submit = () =>
      fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ tier: 'premium' }),
      });

    const [first, second] = await Promise.all([submit(), submit()]);
    const statuses = [first.status, second.status].sort();
    assert.deepStrictEqual(
      statuses,
      [200, 429],
      'one request must succeed, the immediate double-submit must be debounced'
    );
    const successResponse = first.status === 200 ? first : second;
    const successBody = await successResponse.json();
    assert.strictEqual(successBody.planId, 'plan_premium_test');
    assert.strictEqual(whop.verifyCheckoutMetadata(successBody.metadata), true);
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (await issueToken(user)).accessToken,
        },
        body: JSON.stringify({ tier: 'eliteUpgrade' }),
      });
      assert.strictEqual(res.status, 403, `tier=${user.tier} must be rejected`);
    }
  } finally {
    server.close();
  }
});

test('eliteUpgrade returns its configured plan with signed Elite entitlement metadata', async () => {
  const user = await makeUser('checkout-upgrade-premium@test.local', 'premium');
  const server = await startCheckoutApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/checkout/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)).accessToken },
      body: JSON.stringify({ tier: 'eliteUpgrade' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.planId, 'plan_elite_upgrade_test');
    assert.strictEqual(body.tier, 'elite');
    assert.strictEqual(
      body.metadata.tier,
      'elite',
      'must grant the real Elite tier only after the webhook confirms payment'
    );
    assert.strictEqual(body.metadata.userId, String(user.id));
    assert.strictEqual(whop.verifyCheckoutMetadata(body.metadata), true);
    assert.strictEqual(body.sessionId, undefined);
  } finally {
    server.close();
  }
});
