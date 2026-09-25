const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const whop = require('../services/whop');
const { normalizeCode, redeemCoupon } = require('../services/coupons');
const email = require('../services/email');
const { reportError } = require('../utils/reportError');
const { invalidateUserEntitlement } = require('../middleware/authMiddleware');
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
  const payment = data?.payment || data;
  const plan = data?.plan || payment?.plan;
  if (typeof plan === 'string') return plan;
  return plan?.id || data?.plan_id || data?.planId || payment?.plan_id || payment?.planId || null;
}

function paymentIdFromEvent(event) {
  const payment = event?.data?.payment || event?.data;
  const paymentId = payment?.id;
  return typeof paymentId === 'string' && /^pay_[A-Za-z0-9_-]{1,128}$/.test(paymentId) ? paymentId : null;
}

function metadataFromEvent(event) {
  const data = event?.data;
  return data?.payment?.metadata || data?.metadata || null;
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

function assertTrustedCheckoutMetadata(metadata) {
  if (whop.verifyCheckoutMetadata(metadata)) return;
  console.warn('[webhooks/whop] checkout metadata signature could not be verified', safeMetadataSummary(metadata));
  const error = new Error('Whop checkout metadata signature could not be verified');
  error.code = 'WHOP_METADATA_SIGNATURE_INVALID';
  throw error;
}

function assertPaymentId(paymentId) {
  if (paymentId) return;
  const error = new Error('Whop payment ID could not be verified');
  error.code = 'WHOP_PAYMENT_ID_INVALID';
  throw error;
}

function assertPaymentRecordMatches(record, userId, tier, planId) {
  if (
    String(record.user_id) === String(userId) &&
    record.tier === tier &&
    String(record.plan_id) === String(planId)
  ) {
    return;
  }
  const error = new Error('Whop payment ID is already linked to a different checkout');
  error.code = 'WHOP_PAYMENT_RECORD_MISMATCH';
  throw error;
}

async function resolveReversedEntitlement(event) {
  const metadata = metadataFromEvent(event);
  const paymentId = paymentIdFromEvent(event);
  const planId = planIdFromPayment(event);
  const record = paymentId
    ? await db
        .prepare('SELECT payment_id, user_id, tier, plan_id, status FROM whop_payment_entitlements WHERE payment_id = ?')
        .get(paymentId)
    : null;

  if (metadata && whop.verifyCheckoutMetadata(metadata)) {
    assertExpectedPlan(event, metadata.tier);
    if (record) assertPaymentRecordMatches(record, metadata.userId, metadata.tier, planId);
    return { userId: metadata.userId, tier: metadata.tier, paymentId, entitlementStatus: record?.status || null };
  }

  // Old Whop checkout sessions were created server-side and their metadata is
  // covered by this already-verified provider webhook, even though it predates
  // our Elements HMAC. Preserve refund handling for purchases made before the
  // migration; current payment.succeeded grants still require the HMAC above.
  if (
    metadata &&
    typeof metadata.userId === 'string' &&
    metadata.userId.length > 0 &&
    ['premium', 'elite'].includes(metadata.tier)
  ) {
    assertExpectedPlan(event, metadata.tier);
    if (record) assertPaymentRecordMatches(record, metadata.userId, metadata.tier, planId);
    return { userId: metadata.userId, tier: metadata.tier, paymentId, entitlementStatus: record?.status || null };
  }

  // Current refund/dispute payloads nest the payment and may omit custom
  // metadata entirely. Resolve them only through the payment-ID ledger that
  // was written after a verified payment.succeeded webhook.
  if (record) {
    assertExpectedPlan(event, record.tier);
    if (String(record.plan_id) !== String(planId)) {
      const error = new Error('Whop payment plan does not match its recorded checkout');
      error.code = 'WHOP_PAYMENT_RECORD_MISMATCH';
      throw error;
    }
    return {
      userId: String(record.user_id),
      tier: record.tier,
      paymentId,
      entitlementStatus: record.status,
    };
  }

  console.warn('[webhooks/whop] reversal could not be linked to a verified payment', {
    eventType: event.type,
    hasPaymentId: Boolean(paymentId),
    hasMetadata: Boolean(metadata),
  });
  return null;
}

function safeMetadataSummary(metadata) {
  return {
    tier: metadata?.tier || 'unknown',
    hasUserId: Boolean(metadata?.userId),
    hasCouponCode: Boolean(metadata?.couponCode),
    checkoutVersion: metadata?.checkoutVersion || 'legacy-or-missing',
  };
}

// The provider's payment payload is the only trustworthy indication that a
// promo actually changed the charge. Checkout metadata contains the code the
// customer requested, but it does not prove that Whop accepted it.
function providerPromoCode(event) {
  const promo = event?.data?.promo_code;
  if (typeof promo === 'string') return normalizeCode(promo);
  if (promo && typeof promo.code === 'string') return normalizeCode(promo.code);
  return '';
}

function tierRank(tier) {
  return ({ free: 0, premium: 1, elite: 2 })[tier] ?? -1;
}

async function applyPaymentReversal(event, entitlement, { status, reason, restore = false }) {
  const { userId, tier, paymentId } = entitlement;
  const now = Math.floor(Date.now() / 1000);

  return db.transaction(async (tx) => {
    const record = paymentId
      ? await tx.prepare('SELECT status FROM whop_payment_entitlements WHERE payment_id = ? AND user_id = ?').get(paymentId, userId)
      : null;

    if (restore) {
      // A dispute update may arrive before its create event. Restore only from
      // a verified payment ledger entry, never from provider metadata alone,
      // and never undo a refund that has already completed.
      if (!record || record.status === 'refunded') return { changed: false, user: null };

      await tx
        .prepare(
          `UPDATE whop_payment_entitlements
              SET status = 'dispute_won', revoked_at = NULL, revocation_reason = NULL, revocation_event_id = NULL
            WHERE payment_id = ? AND user_id = ? AND status <> 'refunded'`
        )
        .run(paymentId, userId);

      const user = await tx.prepare('SELECT id, tier FROM users WHERE id = ?').get(userId);
      if (user && tierRank(user.tier) < tierRank(tier)) {
        await tx.prepare('UPDATE users SET tier = ?, is_premium = 1 WHERE id = ?').run(tier, user.id);
        await tx
          .prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
          .run('whop-webhook', 'dispute_won_restore', user.id, tier);
        return { changed: true, user };
      }
      return { changed: false, user };
    }

    // A later delivery for an already-refunded payment must not remove access
    // granted by a newer purchase of the same tier.
    if (record?.status === 'refunded' || (reason === 'dispute' && record?.status === 'dispute_won')) {
      return { changed: false, user: null };
    }

    if (paymentId && record) {
      await tx
        .prepare(
          `UPDATE whop_payment_entitlements
              SET status = ?, revoked_at = ?, revocation_reason = ?, revocation_event_id = ?
            WHERE payment_id = ? AND user_id = ? AND status <> 'refunded'`
        )
        .run(status, now, reason, event.id || null, paymentId, userId);
    }

    const user = await tx.prepare('SELECT id, tier FROM users WHERE id = ?').get(userId);
    if (user && user.tier === tier) {
      await tx.prepare(`UPDATE users SET tier = 'free', is_premium = 0 WHERE id = ?`).run(user.id);
      await tx
        .prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
        .run('whop-webhook', reason === 'dispute' ? 'dispute_downgrade' : 'refund_downgrade', user.id, tier);
      return { changed: true, user };
    }
    return { changed: false, user };
  });
}

// Mounted with express.raw() (see server/index.js) — req.body is a Buffer
// here, not parsed JSON, because signature verification must run over the
// exact bytes Whop sent.
router.post('/webhooks/whop', async (req, res) => {
  try {
    // This router is also mounted directly by integration tests and may run
    // outside the normal server bootstrap; always wait for schema migrations
    // before claiming or processing a payment event.
    await db.ready;

    // Keep the exact bytes for signature verification. JSON parsing and even a
    // decode/re-encode round-trip are unnecessary transformations on a
    // security boundary, so derive text only after the signature passes.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');

    if (!whop.verifyWebhookSignature(rawBody, req.headers)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const bodyText = rawBody.toString('utf8');
    let event;
    try {
      event = JSON.parse(bodyText);
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
    if (
      err.code === 'WHOP_PLAN_MISMATCH' ||
      err.code === 'WHOP_METADATA_SIGNATURE_INVALID' ||
      err.code === 'WHOP_PAYMENT_ID_INVALID' ||
      err.code === 'WHOP_PAYMENT_RECORD_MISMATCH'
    ) {
      return res.status(422).json({ error: 'Payment plan could not be verified' });
    }
    reportError(err, '[webhooks/whop]');
    res.status(500).json({ error: 'Server error' });
  }
});

async function handleWhopEvent(event) {
  if (event.type === 'payment_succeeded' || event.type === 'payment.succeeded') {
    const metadata = metadataFromEvent(event);
    if (metadata && metadata.userId && metadata.tier) {
      const tier = metadata.tier;
      assertTrustedCheckoutMetadata(metadata);
      assertExpectedPlan(event, tier);
      const paymentId = paymentIdFromEvent(event);
      const planId = planIdFromPayment(event);
      assertPaymentId(paymentId);
      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .prepare('SELECT payment_id, user_id, tier, plan_id FROM whop_payment_entitlements WHERE payment_id = ?')
          .get(paymentId);
        if (existing) assertPaymentRecordMatches(existing, metadata.userId, tier, planId);
        else {
          await tx
            .prepare(
              `INSERT INTO whop_payment_entitlements (payment_id, user_id, tier, plan_id, created_at)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(paymentId, metadata.userId, tier, String(planId), Math.floor(Date.now() / 1000));
        }
        const buyer = await tx.prepare('SELECT email FROM users WHERE id = ?').get(metadata.userId);
        if (buyer && !existing) {
          await tx.prepare('UPDATE users SET tier = ?, is_premium = 1 WHERE id = ?').run(tier, metadata.userId);
        }
        return { buyer, isNewPayment: !existing };
      });
      const { buyer, isNewPayment } = result;
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
      } else if (isNewPayment && (tier === 'premium' || tier === 'elite')) {
        invalidateUserEntitlement(metadata.userId);

        // Self-service purchases don't go through the admin panel, so this
        // is the only place a tier change like this gets flagged — both an
        // immediate email and an Activity Log entry, so it's visible
        // whether or not the admin happens to be looking at the panel.
        email.sendAdminUpgradeAlert(buyer.email, tier).catch((err) => reportError(err, '[admin-upgrade-alert]'));
        db.prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
          .run('whop-webhook', 'self_service_upgrade', metadata.userId, tier)
          .catch(() => {});
      }
      if (buyer && isNewPayment && metadata.couponCode) {
        const requestedCode = normalizeCode(metadata.couponCode);
        const appliedCode = providerPromoCode(event);
        if (appliedCode && appliedCode === requestedCode) {
          const redeemed = await redeemCoupon(requestedCode);
          if (!redeemed) {
            console.warn(
              '[webhooks/whop] provider-confirmed promo was not recorded in the local campaign ledger',
              safeMetadataSummary(metadata)
            );
          }
        } else {
          // A customer may enter a local campaign code that is missing,
          // expired, or scoped differently in Whop. Never consume a local use
          // for a full-price payment; Whop's payment payload remains the
          // source of truth for whether the discount was applied.
          console.warn(
            '[webhooks/whop] requested promo was not confirmed by provider; local use not consumed',
            safeMetadataSummary(metadata)
          );
        }
      }
    } else {
      console.warn('[webhooks/whop] payment_succeeded with unrecognized metadata', safeMetadataSummary(metadata));
    }
  }

  // Refund.created can describe a refund that is still processing. Do not
  // revoke access until Whop confirms success; refund.updated supplies that
  // transition. The old event aliases are retained for earlier integrations.
  const isCurrentRefund = event.type === 'refund.created' || event.type === 'refund.updated';
  const isLegacyRefund = [
    'payment_refunded',
    'payment.refunded',
    'refund_created',
    'refund_updated',
  ].includes(event.type);
  if (isCurrentRefund && event.data?.status !== 'succeeded') {
    if (!['pending', 'failed', 'canceled', 'cancelled'].includes(event.data?.status)) {
      console.warn('[webhooks/whop] refund event ignored until a confirmed succeeded status', {
        eventType: event.type,
        status: event.data?.status || 'missing',
      });
    }
    return;
  }

  const isDisputeCreated = event.type === 'dispute.created' || event.type === 'dispute_created';
  const isDisputeUpdated = event.type === 'dispute.updated' || event.type === 'dispute_updated';
  if (event.type === 'dispute_alert.created') {
    // A pre-dispute alert is not a chargeback decision; don't revoke paid access.
    return;
  }

  let reversal = null;
  if (isCurrentRefund || isLegacyRefund) {
    reversal = { status: 'refunded', reason: 'refund' };
  } else if (isDisputeCreated) {
    const disputeStatus = String(event.data?.status || '').toLowerCase();
    if (disputeStatus.startsWith('warning_')) return;
    reversal = disputeStatus === 'won'
      ? { status: 'dispute_won', reason: 'dispute', restore: true }
      : { status: 'disputed', reason: 'dispute' };
  } else if (isDisputeUpdated) {
    const disputeStatus = String(event.data?.status || '').toLowerCase();
    if (disputeStatus === 'won') {
      reversal = { status: 'dispute_won', reason: 'dispute', restore: true };
    } else if (!disputeStatus.startsWith('warning_')) {
      if (!['needs_response', 'under_review', 'lost', 'closed', 'other'].includes(disputeStatus)) {
        console.warn('[webhooks/whop] unfamiliar dispute status; keeping access revoked until resolved', {
          status: disputeStatus || 'missing',
        });
      }
      reversal = { status: 'disputed', reason: 'dispute' };
    } else {
      return;
    }
  }

  if (reversal) {
    const entitlement = await resolveReversedEntitlement(event);
    if (!entitlement) return;
    const result = await applyPaymentReversal(event, entitlement, reversal);
    if (result.changed && result.user) invalidateUserEntitlement(result.user.id);
    if (result.changed) {
      console.log(`[webhooks/whop] ${event.type}: entitlement updated`, {
        tier: entitlement.tier,
        restored: Boolean(reversal.restore),
      });
    }
  }
}

module.exports = router;
