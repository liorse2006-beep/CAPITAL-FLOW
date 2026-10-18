process.env.WHOP_WEBHOOK_SECRET = 'isolated-webhook-secret';
process.env.WHOP_PREMIUM_PLAN_ID = 'plan_premium_test';
process.env.WHOP_ELITE_PLAN_ID = 'plan_elite_test';
process.env.WHOP_ELITE_UPGRADE_PLAN_ID = 'plan_elite_upgrade_test';
require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const whop = require('../server/services/whop');
const app = express();
app.use('/api/webhooks/whop', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use('/api', require('../server/routes/checkout'));
app.use('/api', require('../server/routes/webhooks'));
let server;
let origin;
before(async () => {
  await db.ready;
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});
let serial = 0;
async function buyer(tier = 'free') {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier) VALUES (?, 1, ?)')
    .run(`binding-${++serial}@example.test`, tier);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}
async function checkout(user, tier = 'elite') {
  const session = await issueToken(user);
  const response = await fetch(`${origin}/api/checkout/transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ tier }),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function deliver(type, data) {
  const id = `wh_binding_${++serial}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type, data });
  const signature = crypto
    .createHmac('sha256', process.env.WHOP_WEBHOOK_SECRET)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return fetch(`${origin}/api/webhooks/whop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    },
    body,
  });
}
async function tierOf(user) {
  return (await db.prepare('SELECT tier FROM users WHERE id = ?').get(user.id)).tier;
}
function legacy(user, tier = 'elite') {
  const metadata = { userId: String(user.id), tier, checkoutVersion: 'elements-v1' };
  metadata.metadataSignature = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(JSON.stringify(['capital-flow:whop-checkout', 'elements-v1', metadata.userId, tier, '']))
    .digest('base64url');
  return metadata;
}

test('full-price Elite intent cannot be transplanted to the discounted upgrade plan', async () => {
  const user = await buyer();
  const intent = await checkout(user);
  const response = await deliver('payment.succeeded', {
    id: 'pay_plan_transplant',
    plan: { id: 'plan_elite_upgrade_test' },
    metadata: intent.metadata,
  });
  assert.equal(response.status, 422);
  assert.equal(await tierOf(user), 'free');
  assert.equal(
    await db
      .prepare('SELECT payment_id FROM whop_payment_entitlements WHERE payment_id = ?')
      .get('pay_plan_transplant'),
    undefined
  );
});

test('changing the signed plan field cannot turn a normal checkout into an upgrade', async () => {
  const user = await buyer();
  const intent = await checkout(user);
  intent.metadata.planId = 'plan_elite_upgrade_test';
  assert.equal(whop.verifyCheckoutMetadata(intent.metadata), false);
  assert.equal(
    (
      await deliver('payment_succeeded', {
        id: 'pay_plan_field_tamper',
        plan_id: 'plan_elite_upgrade_test',
        metadata: intent.metadata,
      })
    ).status,
    422
  );
  assert.equal(await tierOf(user), 'free');
});

test('a legitimate full-price purchase and Premium upgrade preserve the public checkout contract', async () => {
  for (const [startingTier, requestedTier, expectedPlan] of [
    ['free', 'elite', 'plan_elite_test'],
    ['premium', 'eliteUpgrade', 'plan_elite_upgrade_test'],
  ]) {
    const user = await buyer(startingTier);
    const intent = await checkout(user, requestedTier);
    assert.equal(intent.planId, expectedPlan);
    assert.equal(intent.metadata.planId, expectedPlan);
    assert.equal(intent.purchaseUrl, undefined);
    assert.equal(intent.sessionId, undefined);
    const payment = { id: `pay_legal_${user.id}`, plan: { id: expectedPlan }, metadata: intent.metadata };
    assert.equal((await deliver('payment.succeeded', payment)).status, 200);
    assert.equal(await tierOf(user), 'elite');
    assert.equal((await deliver('payment.succeeded', payment)).status, 200);
    assert.equal(await tierOf(user), 'elite');
  }
});

test('previous signed full-price checkouts still fulfill but unbound legacy upgrade intents cannot grant access', async () => {
  for (const [plan, expectedStatus, expectedTier] of [
    ['plan_elite_test', 200, 'elite'],
    ['plan_elite_upgrade_test', 422, 'free'],
  ]) {
    const user = await buyer();
    assert.equal(
      (
        await deliver('payment.succeeded', {
          id: `pay_legacy_plan_${user.id}`,
          plan: { id: plan },
          metadata: legacy(user),
        })
      ).status,
      expectedStatus
    );
    assert.equal(await tierOf(user), expectedTier);
  }
});

test('unsigned or invalidly signed reversal metadata never selects a victim without a payment mapping', async () => {
  for (const type of [
    'refund.created',
    'refund.updated',
    'payment_refunded',
    'payment.refunded',
    'refund_created',
    'refund_updated',
    'dispute.created',
    'dispute_created',
    'dispute.updated',
    'dispute_updated',
  ]) {
    for (const format of ['unsigned', 'invalid', 'unknown-version']) {
      const victim = await buyer('elite');
      const metadata =
        format === 'unsigned'
          ? { userId: String(victim.id), tier: 'elite' }
          : {
              ...legacy(victim),
              ...(format === 'invalid' ? { metadataSignature: 'x'.repeat(43) } : { checkoutVersion: 'elements-v99' }),
            };
      const payment = { id: `pay_untrusted_${victim.id}`, plan: { id: 'plan_elite_test' }, metadata };
      const data =
        type.includes('refund.') || type.includes('dispute.')
          ? { status: type.startsWith('refund') ? 'succeeded' : 'lost', payment }
          : payment;
      assert.equal((await deliver(type, data)).status, 422);
      assert.equal(await tierOf(victim), 'elite');
      assert.equal(
        await db
          .prepare(
            "SELECT id FROM admin_audit_log WHERE target_user_id = ? AND action IN ('refund_downgrade','dispute_downgrade')"
          )
          .get(victim.id),
        undefined
      );
    }
  }
});

test('reversals require an actual payment identifier even with valid metadata', async () => {
  const user = await buyer('elite');
  assert.equal(
    (await deliver('payment.refunded', { plan: { id: 'plan_elite_test' }, metadata: legacy(user) })).status,
    422
  );
  assert.equal(await tierOf(user), 'elite');
});

test('a recorded historical purchase can be refunded without a current metadata signature', async () => {
  const user = await buyer('elite');
  await db
    .prepare('INSERT INTO whop_payment_entitlements (payment_id,user_id,tier,plan_id,created_at) VALUES (?,?,?,?,?)')
    .run('pay_historical_linked', user.id, 'elite', 'plan_elite_test', 1);
  assert.equal(
    (
      await deliver('refund.created', {
        status: 'succeeded',
        payment: {
          id: 'pay_historical_linked',
          plan: { id: 'plan_elite_test' },
          metadata: { userId: String(user.id), tier: 'elite' },
        },
      })
    ).status,
    200
  );
  assert.equal(await tierOf(user), 'free');
});

test('conflicting reversal metadata cannot redirect a recorded payment to a different customer', async () => {
  const owner = await buyer('elite');
  const victim = await buyer('elite');
  await db
    .prepare('INSERT INTO whop_payment_entitlements (payment_id,user_id,tier,plan_id,created_at) VALUES (?,?,?,?,?)')
    .run('pay_bound_owner', owner.id, 'elite', 'plan_elite_test', 1);
  assert.equal(
    (
      await deliver('refund.created', {
        status: 'succeeded',
        payment: {
          id: 'pay_bound_owner',
          plan: { id: 'plan_elite_test' },
          metadata: { userId: String(victim.id), tier: 'elite' },
        },
      })
    ).status,
    422
  );
  assert.equal(await tierOf(victim), 'elite');
  assert.equal(await tierOf(owner), 'elite');
});

test('a confirmed reversal before payment success is retained and cannot grant refunded access later', async () => {
  for (const type of ['refund.updated', 'dispute.created']) {
    const user = await buyer();
    const intent = await checkout(user);
    const payment = { id: `pay_reversed_first_${user.id}`, plan: { id: intent.planId }, metadata: intent.metadata };
    assert.equal(
      (await deliver(type, { status: type === 'refund.updated' ? 'succeeded' : 'lost', payment })).status,
      200
    );
    assert.equal((await deliver('payment.succeeded', payment)).status, 200);
    assert.equal(await tierOf(user), 'free');
    const record = await db
      .prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?')
      .get(payment.id);
    assert.equal(record.status, type === 'refund.updated' ? 'refunded' : 'disputed');
  }
});

test('concurrent success and refund deliveries converge on revoked access for the same payment', async () => {
  const user = await buyer();
  const intent = await checkout(user);
  const payment = { id: 'pay_concurrent_binding', plan: { id: intent.planId }, metadata: intent.metadata };
  const responses = await Promise.all([
    deliver('payment.succeeded', payment),
    deliver('refund.updated', { status: 'succeeded', payment }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200]
  );
  assert.equal(await tierOf(user), 'free');
  assert.equal(
    (await db.prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ?').get(payment.id)).status,
    'refunded'
  );
});
