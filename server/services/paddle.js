const crypto = require('crypto');
const { PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_ENV } = require('../config');

const API_BASE = PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

const enabled = !!PADDLE_API_KEY;

/** Creates a Paddle transaction server-side so we can attach custom_data
 * (which user/tier this is for) and an optional discount — the frontend
 * then opens Paddle's checkout overlay against the returned transaction id
 * instead of picking a price directly, which is what makes both the coupon
 * discount and the user linkage possible. */
async function createTransaction({ priceId, discountId, customData }) {
  if (!enabled) throw new Error('Paddle is not configured (PADDLE_API_KEY unset)');

  const body = {
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: customData,
  };
  if (discountId) body.discount_id = discountId;

  const res = await fetch(`${API_BASE}/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data && data.error ? data.error.detail || data.error.code : 'Paddle API error';
    throw new Error(message);
  }
  return data.data;
}

/** Paddle signs webhooks as `ts=<unix-seconds>;h1=<hex-hmac>` in the
 * Paddle-Signature header, over the string "<ts>:<raw-body>" using
 * PADDLE_WEBHOOK_SECRET. Must run on the raw (unparsed) request body —
 * re-serializing parsed JSON would not reproduce the same bytes. */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!PADDLE_WEBHOOK_SECRET || !signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(';').map((kv) => {
      const [k, v] = kv.split('=');
      return [k, v];
    })
  );
  if (!parts.ts || !parts.h1) return false;

  const expected = crypto
    .createHmac('sha256', PADDLE_WEBHOOK_SECRET)
    .update(`${parts.ts}:${rawBody}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(parts.h1, 'hex');
  return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { enabled, createTransaction, verifyWebhookSignature };
