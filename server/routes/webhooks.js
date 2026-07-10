const router = require('express').Router();
const db = require('../db');
const paddle = require('../services/paddle');
const { redeemCoupon } = require('../services/coupons');

const TIER_UPDATE = {
  premium: (userId) => db.prepare("UPDATE users SET tier = 'premium', is_premium = 1 WHERE id = ?").run(userId),
  elite: (userId) => db.prepare("UPDATE users SET tier = 'elite', is_premium = 1 WHERE id = ?").run(userId),
};

// Mounted with express.raw() (see server/index.js) — req.body is a Buffer
// here, not parsed JSON, because signature verification must run over the
// exact bytes Paddle sent.
router.post('/webhooks/paddle', (req, res) => {
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

  if (event.event_type === 'transaction.completed') {
    const customData = event.data && event.data.custom_data;
    if (customData && customData.userId && TIER_UPDATE[customData.tier]) {
      TIER_UPDATE[customData.tier](customData.userId);
      if (customData.couponCode) redeemCoupon(customData.couponCode);
    } else {
      console.warn('[webhooks/paddle] transaction.completed with unrecognized custom_data', customData);
    }
  }

  res.json({ ok: true });
});

module.exports = router;
