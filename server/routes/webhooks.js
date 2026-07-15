const router = require('express').Router();
const db = require('../db');
const paddle = require('../services/paddle');
const { redeemCoupon } = require('../services/coupons');

// Mounted with express.raw() (see server/index.js) — req.body is a Buffer
// here, not parsed JSON, because signature verification must run over the
// exact bytes Paddle sent.
router.post('/webhooks/paddle', async (req, res) => {
  try {
    const signature = req.headers['paddle-signature'];
    const rawBody = req.body.toString('utf8');

    if (!paddle.verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Malformed payload' });
    }

    // Paddle redelivers webhooks that don't get a timely 2xx (network hiccup,
    // slow DB, etc.) — without this, a redelivered transaction.completed
    // would redeem the same coupon code a second time. event_id uniquely
    // identifies this specific delivery; skip processing (but still 200) if
    // we've already handled it. Older/synthetic payloads without an
    // event_id fall through unprotected rather than being rejected.
    if (event.event_id) {
      const inserted = await db
        .prepare('INSERT OR IGNORE INTO processed_webhook_events (event_id) VALUES (?)')
        .run(event.event_id);
      if (inserted.changes === 0) {
        return res.json({ ok: true, duplicate: true });
      }
    }

    if (event.event_type === 'transaction.completed') {
      const customData = event.data && event.data.custom_data;
      if (customData && customData.userId && customData.tier) {
        const tier = customData.tier;
        if (tier === 'premium' || tier === 'elite') {
          await db.prepare(`UPDATE users SET tier = ?, is_premium = 1 WHERE id = ?`).run(tier, customData.userId);
        }
        if (customData.couponCode) await redeemCoupon(customData.couponCode);
      } else {
        console.warn('[webhooks/paddle] transaction.completed with unrecognized custom_data', customData);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[webhooks/paddle]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
