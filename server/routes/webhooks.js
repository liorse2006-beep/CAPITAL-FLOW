const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const whop = require('../services/whop');
const { redeemCoupon } = require('../services/coupons');
const email = require('../services/email');
const { reportError } = require('../utils/reportError');
const { WHOP_ELITE_PLAN_ID, WHOP_ELITE_UPGRADE_PLAN_ID, WHOP_PREMIUM_PLAN_ID } = require('../config');

// A webhook handler should finish well inside this lease. If the process is
// killed after claiming but before completion, a later Whop retry may take
// over only after the lease expires. Without the lease, two deliveries that
// arrive while the first is still running can both execute payment side
// effects. Keep the value comfortably below the five-minute signature age so
// a valid retry still has a chance to recover a crashed process.
const WEBHOOK_CLAIM_LEASE_SEC = 60;

function planIdFromPayment(event) {
  const data = event?.data;
  if (typeof data?.plan === 'string') return data.plan;
  return data?.plan?.id || data?.plan_id || data?.planId || null;
}

function expectedPlanIds(tier) {
  if (tier === 'premium') return [WHOP_PREMIUM_PLAN_ID].filter(Boolean);
  if (tier === 'elite') return [WHOP_ELITE_PLAN_ID, WHOP_ELITE_UPGRADE_PLAN_ID].filter(Boolean);
  return [];
}

function assertExpectedPlan(event, tier) {
  const planId = planIdFromPayment(event);
  const expected = expectedPlanIds(tier);
  if (!planId || expected.length === 0 || !expected.includes(String(planId))) {
    // Never grant or revoke access based only on client-controlled metadata.
    // Whop's payment webhook includes the authoritative plan object; require
    // it to match the plan that our checkout endpoint issued for this tier.
    const error = new Error('Whop payment plan could not be verified');
    error.code = 'WHOP_PLAN_MISMATCH';
    throw error;
  }
}

function safeMetadataSummary(metadata) {
  return {
    tier: metadata?.tier || 'unknown',
    hasUserId: Boolean(metadata?.userId),
    hasCouponCode: Boolean(metadata?.couponCode),
  };
}

// Mounted with express.raw() (see server/index.js) — req.body is a Buffer
// here, not parsed JSON, because signature verification must run over the
// exact bytes Whop sent.
router.post('/webhooks/whop', async (req, res) => {
  try {
    const rawBody = req.body.toString('utf8');

    if (!whop.verifyWebhookSignature(rawBody, req.headers)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Malformed payload' });
    }

    // Whop redelivers webhooks that don't get a timely 2xx, and can deliver
    // the same event twice concurrently. A SELECT-then-INSERT-at-the-end
    // check has a race: two overlapping deliveries can both pass the SELECT
    // before either has inserted, and both run the business logic below
    // (double-crediting a coupon redemption, double-sending an email).
    // INSERT ... ON CONFLICT DO NOTHING is atomic — only one concurrent
    // request can initially claim a given event_id. A claim token and a
    // short lease make the recovery path atomic too: a concurrent delivery
    // cannot steal a live claim, while a retry after a crashed process can
    // take over an old one. If business logic then fails, only the request
    // owning that token releases the claim, so a transient DB/email failure
    // never permanently discards a paid upgrade and never deletes a newer
    // retry's claim.
    const webhookId = req.headers['webhook-id'];
    const claimToken = crypto.randomUUID();
    const claimStartedAt = Math.floor(Date.now() / 1000);
    let shouldProcess = true;
    if (webhookId) {
      const claim = await db
        .prepare(
          'INSERT INTO processed_webhook_events (event_id, processed_at, claim_token) VALUES (?, ?, ?) ON CONFLICT(event_id) DO NOTHING'
        )
        .run(webhookId, claimStartedAt, claimToken);
      if (claim.changes === 0) {
        // The row already existed. Two possibilities: a genuine duplicate
        // delivery of an event that already finished (completed_at set) —
        // or a claim from a delivery whose process was killed mid-flight
        // (e.g. a deploy) before it ever reached the completed_at UPDATE at
        // the bottom of this handler. The second case used to be treated
        // exactly like the first — Whop's retry saw the row, gave up, and
        // the payment/tier-grant it carried was silently dropped forever.
        // The UPDATE's WHERE guard makes "does THIS request get to retry
        // it" atomic across concurrent deliveries — only one can ever win
        // the stale lease, and a still-live claim is treated as a duplicate.
        const retryClaim = await db
          .prepare(
            'UPDATE processed_webhook_events SET processed_at = ?, claim_token = ? WHERE event_id = ? AND completed_at IS NULL AND processed_at <= ?'
          )
          .run(claimStartedAt, claimToken, webhookId, claimStartedAt - WEBHOOK_CLAIM_LEASE_SEC);
        shouldProcess = retryClaim.changes > 0;
      }
    }

    if (!shouldProcess) {
      return res.json({ ok: true, duplicate: true });
    }

    try {
      await handleWhopEvent(event);
      if (webhookId) {
        await db
          .prepare(
            'UPDATE processed_webhook_events SET completed_at = ? WHERE event_id = ? AND claim_token = ? AND completed_at IS NULL'
          )
          .run(Math.floor(Date.now() / 1000), webhookId, claimToken);
      }
    } catch (err) {
      if (webhookId)
        await db
          .prepare('DELETE FROM processed_webhook_events WHERE event_id = ? AND claim_token = ?')
          .run(webhookId, claimToken);
      throw err;
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'WHOP_PLAN_MISMATCH') {
      return res.status(422).json({ error: 'Payment plan could not be verified' });
    }
    reportError(err, '[webhooks/whop]');
    res.status(500).json({ error: 'Server error' });
  }
});

async function handleWhopEvent(event) {
  if (event.type === 'payment_succeeded' || event.type === 'payment.succeeded') {
    const metadata = event.data && event.data.metadata;
    if (metadata && metadata.userId && metadata.tier) {
      const tier = metadata.tier;
      assertExpectedPlan(event, tier);
      const buyer = await db.prepare('SELECT email FROM users WHERE id = ?').get(metadata.userId);
      if (!buyer) {
        // The account existed at checkout time but is gone by the time Whop
        // delivers the webhook (deleted between purchase and delivery) — a
        // real paying customer got nothing and a console.warn alone means
        // no human ever finds out. Escalate the same way a self-service
        // upgrade does, so it's visible in both the inbox and the panel.
        console.warn(
          '[webhooks/whop] payment_succeeded for a user that no longer exists',
          safeMetadataSummary(metadata)
        );
        email
          .sendAdminUpgradeAlert(
            `(deleted user id ${metadata.userId})`,
            `${tier} — PAYMENT SUCCEEDED BUT ACCOUNT MISSING, NEEDS MANUAL REFUND/FOLLOW-UP`
          )
          .catch((err) => reportError(err, '[admin-upgrade-alert]'));
        db.prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
          .run('whop-webhook', 'payment_for_missing_user', metadata.userId, tier)
          .catch(() => {});
      } else if (tier === 'premium' || tier === 'elite') {
        await db.prepare(`UPDATE users SET tier = ?, is_premium = 1 WHERE id = ?`).run(tier, metadata.userId);

        // Self-service purchases don't go through the admin panel, so this
        // is the only place a tier change like this gets flagged — both an
        // immediate email and an Activity Log entry, so it's visible
        // whether or not the admin happens to be looking at the panel.
        email.sendAdminUpgradeAlert(buyer.email, tier).catch((err) => reportError(err, '[admin-upgrade-alert]'));
        db.prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
          .run('whop-webhook', 'self_service_upgrade', metadata.userId, tier)
          .catch(() => {});
      }
      if (buyer && metadata.couponCode) {
        const redeemed = await redeemCoupon(metadata.couponCode);
        if (!redeemed) {
          console.warn(
            '[webhooks/whop] coupon was not redeemed (missing or at its usage limit)',
            safeMetadataSummary(metadata)
          );
        }
      }
    } else {
      console.warn('[webhooks/whop] payment_succeeded with unrecognized metadata', safeMetadataSummary(metadata));
    }
  }

  // A refunded / disputed payment takes the paid access back. Without
  // this, anyone could buy Elite, request a refund from Whop, and keep
  // the subscription forever — a free-money hole. The metadata is the
  // same object our checkout session attached, so it names exactly which
  // tier this payment bought.
  if (
    event.type === 'payment_refunded' ||
    event.type === 'payment.refunded' ||
    event.type === 'refund_created' ||
    event.type === 'dispute_created'
  ) {
    const metadata = event.data && event.data.metadata;
    if (metadata && metadata.userId && metadata.tier) {
      assertExpectedPlan(event, metadata.tier);
      const user = await db.prepare('SELECT id, tier FROM users WHERE id = ?').get(metadata.userId);
      // Only strip the tier this refunded payment actually bought — a user
      // who bought Premium, upgraded to Elite, then refunded the OLD
      // Premium payment keeps the Elite they still paid for.
      if (user && user.tier === metadata.tier) {
        await db.prepare(`UPDATE users SET tier = 'free', is_premium = 0 WHERE id = ?`).run(user.id);
        console.log(`[webhooks/whop] ${event.type}: tier downgraded to free`, { tier: metadata.tier });
        // Best-effort audit trail — visible in the admin panel's activity log.
        db.prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
          .run('whop-webhook', 'refund_downgrade', user.id, metadata.tier)
          .catch(() => {});
      } else if (user) {
        console.log(
          `[webhooks/whop] ${event.type}: refunded ${metadata.tier} payment but account holds ${user.tier} — no change`
        );
      }
    } else {
      console.warn('[webhooks/whop] refund event with unrecognized metadata', safeMetadataSummary(metadata));
    }
  }
}

module.exports = router;
