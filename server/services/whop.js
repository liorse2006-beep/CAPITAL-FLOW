const crypto = require('crypto');
const { JWT_SECRET, WHOP_WEBHOOK_SECRET } = require('../config');

const CHECKOUT_METADATA_VERSION = 'elements-v1';
const CHECKOUT_TIERS = new Set(['premium', 'elite']);

function checkoutMetadataPayload({ userId, tier, couponCode }) {
  // Fixed-order, domain-separated serialization prevents the same HMAC from
  // being usable as a token for a different feature or field combination.
  return JSON.stringify(['capital-flow:whop-checkout', CHECKOUT_METADATA_VERSION, userId, tier, couponCode || '']);
}

/**
 * Creates webhook metadata for Whop Elements. Elements mints its checkout
 * session in the browser, so metadata itself is client-visible; the HMAC
 * makes the account, entitlement and optional campaign code tamper-evident.
 */
function createCheckoutMetadata({ userId, tier, couponCode = '' }) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || normalizedUserId.length > 128 || !CHECKOUT_TIERS.has(tier)) {
    throw new TypeError('Invalid Whop checkout metadata');
  }
  if (couponCode && (typeof couponCode !== 'string' || couponCode.length > 32)) {
    throw new TypeError('Invalid Whop checkout metadata');
  }

  const metadata = {
    userId: normalizedUserId,
    tier,
    checkoutVersion: CHECKOUT_METADATA_VERSION,
    ...(couponCode ? { couponCode } : {}),
  };
  metadata.metadataSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(checkoutMetadataPayload(metadata), 'utf8')
    .digest('base64url');
  return metadata;
}

/** Verifies client-visible checkout metadata before it can affect access. */
function verifyCheckoutMetadata(metadata) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    typeof metadata.userId !== 'string' ||
    !metadata.userId.trim() ||
    metadata.userId.length > 128 ||
    !CHECKOUT_TIERS.has(metadata.tier) ||
    metadata.checkoutVersion !== CHECKOUT_METADATA_VERSION ||
    (metadata.couponCode !== undefined &&
      (typeof metadata.couponCode !== 'string' || metadata.couponCode.length > 32)) ||
    typeof metadata.metadataSignature !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(metadata.metadataSignature)
  ) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(checkoutMetadataPayload(metadata), 'utf8')
    .digest();
  const actual = Buffer.from(metadata.metadataSignature, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
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

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  if (!entry || Array.isArray(entry[1])) return '';
  return typeof entry[1] === 'string' ? entry[1].trim() : '';
}

function normalizedWebhookSecret() {
  let secret = typeof WHOP_WEBHOOK_SECRET === 'string' ? WHOP_WEBHOOK_SECRET.trim() : '';
  // Render's environment editor accepts quoted pasted values literally. Only
  // remove a matching pair at the edges; never alter characters inside the
  // secret or try to repair an otherwise malformed value.
  if (secret.length >= 2 && secret[0] === secret.at(-1) && (secret[0] === '"' || secret[0] === "'")) {
    secret = secret.slice(1, -1);
  }
  return secret;
}

function webhookSigningKey(secret) {
  // Whop's current `ws_...` signing secret is the HMAC key exactly as
  // provided. Older Standard Webhooks production secrets use the `whsec_`
  // prefix and base64-encode the key after it; supporting that explicit
  // format keeps verification compatible without trying multiple guesses.
  if (secret.startsWith('whsec_')) {
    const encoded = secret.slice('whsec_'.length);
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.length > 0) return decoded;
    }
  }
  return Buffer.from(secret, 'utf8');
}

/** Whop signs webhooks per the Standard Webhooks spec: webhook-id,
 * webhook-timestamp, and webhook-signature ("v1,<base64-hmac-sha256>")
 * headers, computed over "<id>.<timestamp>.<raw-body>". The configured
 * `ws_...` secret is used exactly as provided by Whop. Must run on the raw
 * (unparsed) request body — re-serializing parsed JSON would not reproduce
 * the same bytes. */
function verifyWebhookSignature(rawBody, headers) {
  const secret = normalizedWebhookSecret();
  const id = headerValue(headers, 'webhook-id');
  const timestamp = headerValue(headers, 'webhook-timestamp');
  const signatureHeader = headerValue(headers, 'webhook-signature');
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  const timestampNum = Number(timestamp);
  if (!Number.isSafeInteger(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > MAX_WEBHOOK_AGE_SEC) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const signedContent = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), body]);
  const expectedBuf = crypto.createHmac('sha256', webhookSigningKey(secret)).update(signedContent).digest();

  // webhook-signature can carry multiple space-separated "v1,<sig>" values —
  // match against any of them, as required for zero-downtime key rotation.
  return signatureHeader.split(/\s+/).some((entry) => {
    const separator = entry.indexOf(',');
    if (separator <= 0 || entry.slice(0, separator) !== 'v1') return false;
    const signature = entry.slice(separator + 1);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    const actualBuf = Buffer.from(signature, 'base64');
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  });
}

module.exports = {
  createCheckoutMetadata,
  verifyCheckoutMetadata,
  verifyWebhookSignature,
};
