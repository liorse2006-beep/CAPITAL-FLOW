const crypto = require('crypto');
const { WHOP_API_KEY, WHOP_WEBHOOK_SECRET } = require('../config');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');

const API_BASE = 'https://api.whop.com/api/v2';

const enabled = !!WHOP_API_KEY;

/** Creates a Whop checkout session server-side so we can attach metadata
 * (which user/tier this is for) — the frontend mounts the returned session in
 * Whop's embedded checkout (with purchase_url retained as a fallback), which
 * is what makes the user linkage possible (the webhook reads this metadata
 * back). */
async function createCheckoutSession({ planId, metadata, redirectUrl, allowPromoCodes = true }) {
  if (!enabled) throw new Error('Whop is not configured (WHOP_API_KEY unset)');

  const body = { plan_id: planId, metadata, allow_promo_codes: allowPromoCodes };
  if (redirectUrl) body.redirect_url = redirectUrl;

  const res = await fetchWithTimeout(`${API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHOP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data && data.error ? data.error.message || data.error : 'Whop API error';
    throw new Error(message);
  }
  return data;
}

// Standard Webhooks spec's own recommended tolerance — rejects a
// perfectly-valid-looking signature if the timestamp is stale. Without this,
// a captured request (logs, a proxy, a compromised intermediary) stays
// replayable forever: the signature alone never expires, since it's just an
// HMAC over fixed bytes. This is on top of, not instead of, the
// processed_webhook_events dedup table — that only catches a *repeat* of an
// id already seen; this catches an old request being replayed after the
// dedup record itself might plausibly have been pruned or never existed.
const MAX_WEBHOOK_AGE_SEC = 5 * 60;

/** Whop signs webhooks per the Standard Webhooks spec: webhook-id,
 * webhook-timestamp, and webhook-signature ("v1,<base64-hmac-sha256>")
 * headers, computed over "<id>.<timestamp>.<raw-body>" with
 * WHOP_WEBHOOK_SECRET. Must run on the raw (unparsed) request body —
 * re-serializing parsed JSON would not reproduce the same bytes. */
function verifyWebhookSignature(rawBody, headers) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!WHOP_WEBHOOK_SECRET || !id || !timestamp || !signatureHeader) return false;

  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > MAX_WEBHOOK_AGE_SEC) return false;

  const expected = crypto
    .createHmac('sha256', WHOP_WEBHOOK_SECRET)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected, 'base64');

  // webhook-signature can carry multiple space-separated "v1,<sig>" values —
  // match against any of them.
  return signatureHeader.split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const actualBuf = Buffer.from(signature, 'base64');
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  });
}

module.exports = { enabled, createCheckoutSession, verifyWebhookSignature };
