const crypto = require('crypto');
const {
  JWT_SECRET,
  WHOP_WEBHOOK_SECRET,
  WHOP_PREMIUM_PLAN_ID,
  WHOP_ELITE_PLAN_ID,
  WHOP_ELITE_UPGRADE_PLAN_ID,
} = require('../config');

const CHECKOUT_METADATA_VERSION = 'elements-v2';
const CHECKOUT_TIERS = new Set(['premium', 'elite']);

function checkoutMetadataPayload({ userId, tier, couponCode, planId, checkoutVersion, authorizationId, expiresAt }) {
  // Fixed-order, domain-separated serialization prevents the same HMAC from
  // being usable as a token for a different feature or field combination.
  const fields = ['capital-flow:whop-checkout', checkoutVersion, userId, tier, couponCode || ''];
  if (checkoutVersion !== 'elements-v1') fields.push(planId);
  if (checkoutVersion === 'elements-v3') fields.push(authorizationId, expiresAt);
  return JSON.stringify(fields);
}

/**
 * Creates webhook metadata for Whop Elements. Elements mints its checkout
 * session in the browser, so metadata itself is client-visible; the HMAC
 * makes the account, entitlement and optional campaign code tamper-evident.
 */
function createCheckoutMetadata({
  userId,
  tier,
  couponCode = '',
  planId = tier === 'premium' ? WHOP_PREMIUM_PLAN_ID : WHOP_ELITE_PLAN_ID,
  authorizationId,
  expiresAt,
}) {
  const normalizedUserId = String(userId || '').trim();
  if (
    !normalizedUserId ||
    normalizedUserId.length > 128 ||
    !CHECKOUT_TIERS.has(tier) ||
    typeof planId !== 'string' ||
    !/^plan_[A-Za-z0-9_-]{1,128}$/.test(planId)
  ) {
    throw new TypeError('Invalid Whop checkout metadata');
  }
  if (couponCode && (typeof couponCode !== 'string' || couponCode.length > 32)) {
    throw new TypeError('Invalid Whop checkout metadata');
  }

  const metadata = {
    userId: normalizedUserId,
    tier,
    checkoutVersion: authorizationId ? 'elements-v3' : CHECKOUT_METADATA_VERSION,
    planId,
    ...(authorizationId ? { authorizationId, expiresAt: String(expiresAt) } : {}),
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
    !['elements-v1', CHECKOUT_METADATA_VERSION, 'elements-v3'].includes(metadata.checkoutVersion) ||
    (metadata.checkoutVersion !== 'elements-v1' &&
      (typeof metadata.planId !== 'string' || !/^plan_[A-Za-z0-9_-]{1,128}$/.test(metadata.planId))) ||
    (metadata.checkoutVersion === 'elements-v3' &&
      (typeof metadata.authorizationId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(metadata.authorizationId) ||
        !/^\d{10}$/.test(metadata.expiresAt))) ||
    (metadata.couponCode !== undefined &&
      (typeof metadata.couponCode !== 'string' || metadata.couponCode.length > 32)) ||
    typeof metadata.metadataSignature !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(metadata.metadataSignature)
  ) {
    return false;
  }

  const expected = crypto.createHmac('sha256', JWT_SECRET).update(checkoutMetadataPayload(metadata), 'utf8').digest();
  const actual = Buffer.from(metadata.metadataSignature, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
}

// The discounted upgrade is issued while eligibility is current, bound to
// one payment, and expires for NEW purchases. Delayed webhooks for a payment
// created inside the window remain valid; they must not strip paid access.
async function issueUpgradeCheckoutMetadata(userId) {
  return require('./userWrite').withUserWrite(userId, async (tx) => {
    const buyer = await tx.prepare('SELECT tier FROM users WHERE id = ?').get(userId);
    if (buyer?.tier !== 'premium') {
      const error = new Error('This offer is only available to Premium accounts');
      error.code = 'CHECKOUT_NOT_ELIGIBLE';
      throw error;
    }
    const now = Math.floor(Date.now() / 1000);
    // Reuse a still-open offer instead of creating unbounded abandoned rows.
    // Expired evidence is retained: its payment may already have succeeded
    // while the provider webhook is still being retried.
    const pending = await tx
      .prepare(
        'SELECT * FROM whop_checkout_authorizations WHERE user_id = ? AND plan_id = ? AND payment_id IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY issued_at DESC LIMIT 1'
      )
      .get(userId, WHOP_ELITE_UPGRADE_PLAN_ID, now + 300);
    if (pending)
      return createCheckoutMetadata({
        userId,
        tier: 'elite',
        planId: pending.plan_id,
        authorizationId: pending.authorization_id,
        expiresAt: pending.expires_at,
      });
    const authorizationId = crypto.randomUUID();
    const expiresAt = now + 86400;
    await tx
      .prepare(
        `INSERT INTO whop_checkout_authorizations
      (authorization_id, user_id, plan_id, tier, issued_at, expires_at) VALUES (?, ?, ?, 'elite', ?, ?)`
      )
      .run(authorizationId, userId, WHOP_ELITE_UPGRADE_PLAN_ID, now, expiresAt);
    return createCheckoutMetadata({
      userId,
      tier: 'elite',
      planId: WHOP_ELITE_UPGRADE_PLAN_ID,
      authorizationId,
      expiresAt,
    });
  });
}

function paymentCreatedAt(event) {
  const payment = event?.data?.payment || event?.data;
  const value = payment?.paid_at ?? payment?.created_at;
  if (value == null) return null;
  const seconds =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? value
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? Date.parse(value) / 1000
        : NaN;
  return Number.isFinite(seconds) && seconds >= 1000000000 && seconds <= Date.now() / 1000 + 300 ? seconds : NaN;
}

async function revokeUnusedCheckoutAuthorizations(userId, tx) {
  await tx
    .prepare(
      'UPDATE whop_checkout_authorizations SET revoked_at = ? WHERE user_id = ? AND payment_id IS NULL AND revoked_at IS NULL'
    )
    .run(Date.now(), userId);
}

async function claimCheckoutAuthorization(metadata, paymentId, event, tx) {
  if (metadata.checkoutVersion !== 'elements-v3') return;
  const db = require('../db');
  const row = await tx
    .prepare(
      'SELECT * FROM whop_checkout_authorizations WHERE authorization_id = ?' +
        (db.dialect === 'postgres' ? ' FOR UPDATE' : '')
    )
    .get(metadata.authorizationId);
  const providerTime = paymentCreatedAt(event);
  const createdAt = providerTime ?? Math.floor(Date.now() / 1000);
  const buyer = await tx.prepare('SELECT tier FROM users WHERE id = ?').get(metadata.userId);
  if (
    !row ||
    String(row.user_id) !== metadata.userId ||
    row.plan_id !== metadata.planId ||
    row.tier !== metadata.tier ||
    String(row.expires_at) !== metadata.expiresAt ||
    (row.payment_id && row.payment_id !== paymentId) ||
    (!row.payment_id &&
      ((providerTime == null && (row.revoked_at != null || buyer?.tier !== 'premium')) ||
        !Number.isFinite(createdAt) ||
        (row.revoked_at != null && createdAt * 1000 >= row.revoked_at) ||
        createdAt < row.issued_at - 300 ||
        createdAt > row.expires_at ||
        createdAt > Date.now() / 1000 + 300))
  ) {
    const error = new Error('Checkout authorization is invalid or already used');
    error.code = 'WHOP_PLAN_MISMATCH';
    throw error;
  }
  await tx
    .prepare('UPDATE whop_checkout_authorizations SET payment_id = ? WHERE authorization_id = ?')
    .run(paymentId, metadata.authorizationId);
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
  issueUpgradeCheckoutMetadata,
  claimCheckoutAuthorization,
  paymentCreatedAt,
  revokeUnusedCheckoutAuthorizations,
  verifyCheckoutMetadata,
  verifyWebhookSignature,
};
