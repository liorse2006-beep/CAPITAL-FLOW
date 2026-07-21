const router = require('express').Router();
const db = require('../db');
const whop = require('../services/whop');
const { redeemCoupon } = require('../services/coupons');

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
        }
        if (metadata.couponCode) await redeemCoupon(metadata.couponCode);
      } else {
        console.warn('[webhooks/whop] payment_succeeded with unrecognized metadata', metadata);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[webhooks/whop]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
