const router = require('express').Router();
const db = require('../db');
const whop = require('../services/whop');
const { redeemCoupon } = require('../services/coupons');
const email = require('../services/email');
const { priceForPurchase } = require('../services/pricing');

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

    // Whop redelivers webhooks that don't get a timely 2xx (network hiccup,
    // slow DB, etc.) — without this, a redelivered payment_succeeded would
    // redeem the same coupon code a second time. The webhook-id header
    // (Standard Webhooks spec) uniquely identifies this specific delivery;
    // skip processing (but still 200) if we've already handled it.
    const webhookId = req.headers['webhook-id'];
    if (webhookId) {
      const inserted = await db
        .prepare('INSERT OR IGNORE INTO processed_webhook_events (event_id) VALUES (?)')
        .run(webhookId);
      if (inserted.changes === 0) {
        return res.json({ ok: true, duplicate: true });
      }
    }

    if (event.type === 'payment_succeeded' || event.type === 'payment.succeeded') {
      const metadata = event.data && event.data.metadata;
      if (metadata && metadata.userId && metadata.tier) {
        const tier = metadata.tier;
        if (tier === 'premium' || tier === 'elite') {
          await db.prepare(`UPDATE users SET tier = ?, is_premium = 1 WHERE id = ?`).run(tier, metadata.userId);

          // Revenue ledger — a dated, per-event record (see server/db/index.js
          // for why this can't just be inferred from current tier counts).
          const amountCents = priceForPurchase(tier, !!metadata.isUpgrade);
          db.prepare(
            'INSERT INTO payment_events (user_id, tier, event_type, amount_cents, whop_event_id) VALUES (?, ?, ?, ?, ?)'
          )
            .run(metadata.userId, tier, 'purchase', amountCents, webhookId || null)
            .catch((err) => console.error('[payment-ledger]', err));

          // Self-service purchases don't go through the admin panel, so this
          // is the only place a tier change like this gets flagged — both an
          // immediate email and an Activity Log entry, so it's visible
          // whether or not the admin happens to be looking at the panel.
          const buyer = await db.prepare('SELECT email FROM users WHERE id = ?').get(metadata.userId);
          if (buyer && buyer.email) {
            email.sendAdminUpgradeAlert(buyer.email, tier).catch((err) => console.error('[admin-upgrade-alert]', err));
          }
          db.prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
            .run('whop-webhook', 'self_service_upgrade', metadata.userId, tier)
            .catch(() => {});
        }
        if (metadata.couponCode) await redeemCoupon(metadata.couponCode);
      } else {
        console.warn('[webhooks/whop] payment_succeeded with unrecognized metadata', metadata);
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
        const user = await db.prepare('SELECT id, tier FROM users WHERE id = ?').get(metadata.userId);
        // Only strip the tier this refunded payment actually bought — a user
        // who bought Premium, upgraded to Elite, then refunded the OLD
        // Premium payment keeps the Elite they still paid for.
        if (user && user.tier === metadata.tier) {
          await db.prepare(`UPDATE users SET tier = 'free', is_premium = 0 WHERE id = ?`).run(user.id);
          console.log(`[webhooks/whop] ${event.type}: user ${user.id} downgraded from ${metadata.tier} to free`);
          // Best-effort audit trail — visible in the admin panel's activity log.
          db.prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
            .run('whop-webhook', 'refund_downgrade', user.id, metadata.tier)
            .catch(() => {});

          // Revenue ledger — refund the exact amount that specific purchase's
          // own ledger row recorded (accurate even if pricing changed since),
          // falling back to today's price table for a pre-ledger purchase.
          db.prepare(
            "SELECT amount_cents FROM payment_events WHERE user_id = ? AND tier = ? AND event_type = 'purchase' ORDER BY created_at DESC LIMIT 1"
          )
            .get(user.id, metadata.tier)
            .then((row) => {
              const refundedCents = row ? row.amount_cents : priceForPurchase(metadata.tier, false);
              return db
                .prepare('INSERT INTO payment_events (user_id, tier, event_type, amount_cents, whop_event_id) VALUES (?, ?, ?, ?, ?)')
                .run(user.id, metadata.tier, 'refund', -refundedCents, webhookId || null);
            })
            .catch((err) => console.error('[payment-ledger]', err));
        } else if (user) {
          console.log(
            `[webhooks/whop] ${event.type}: user ${user.id} refunded a ${metadata.tier} payment but holds ${user.tier} — no change`
          );
        }
      } else {
        console.warn('[webhooks/whop] refund event with unrecognized metadata', metadata);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[webhooks/whop]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
