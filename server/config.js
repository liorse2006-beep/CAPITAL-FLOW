require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// ── Fail-closed on missing auth secrets ────────────────────────────────────
// A weak/guessable JWT secret lets anyone forge an admin token. Rather than
// silently fall back to a public default, refuse to boot. This guarantees the
// forged-token vulnerability can never recur, in any environment.
const INSECURE = new Set(['', 'dev-secret-change-in-production', 'dev-session-secret', 'secret', 'changeme']);
function requireSecret(name) {
  const val = process.env[name] || '';
  if (INSECURE.has(val) || val.length < 32) {
    console.error(
      `\n[FATAL] ${name} is missing or too weak. ` +
        `Set a strong value (≥32 chars) in .env before starting.\n` +
        `Generate one with:  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`
    );
    process.exit(1);
  }
  return val;
}

// ADMIN_TOKEN is optional (the admin panel just stays disabled without it),
// but if it IS set it grants full admin power — view every user's email,
// grant/revoke premium, block, and permanently delete accounts. A weak value
// here is exactly as dangerous as a weak JWT_SECRET, so it gets the same
// fail-closed treatment, just skipped entirely when unset.
const rawAdminToken = process.env.ADMIN_TOKEN || '';
if (rawAdminToken && (INSECURE.has(rawAdminToken) || rawAdminToken.length < 32)) {
  console.error(
    `\n[FATAL] ADMIN_TOKEN is set but too weak (${rawAdminToken.length} chars). ` +
      `It grants full admin access — set a strong value (≥32 chars) or unset it entirely.\n` +
      `Generate one with:  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`
  );
  process.exit(1);
}

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3001,
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY || '',
  // Extra Finnhub accounts for automatic rotation/failover — see services/finnhubKeyPool.js
  FINNHUB_API_KEY_POOL: [1, 2, 3, 4].map((i) => process.env['FINNHUB_API_KEY_POOL_' + i]).filter(Boolean),
  MASSIVE_API_KEY: process.env.MASSIVE_API_KEY || '',
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || '',
  JWT_SECRET: requireSecret('JWT_SECRET'),
  GMAIL_USER: process.env.GMAIL_USER || '',
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback',
  HCAPTCHA_SECRET: process.env.HCAPTCHA_SECRET || '',
  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || '',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  SESSION_SECRET: requireSecret('SESSION_SECRET'),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  // Paddle (checkout) — all opt-in, same pattern as Sentry: features that
  // depend on these simply no-op until they're set. PADDLE_ENV controls
  // which Paddle API host is used (sandbox vs live).
  PADDLE_API_KEY: process.env.PADDLE_API_KEY || '',
  PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET || '',
  PADDLE_ENV: process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox',
  PADDLE_PREMIUM_PRICE_ID: process.env.PADDLE_PREMIUM_PRICE_ID || '',
  PADDLE_ELITE_PRICE_ID: process.env.PADDLE_ELITE_PRICE_ID || '',
  // Turso cloud SQLite — set for production (Koyeb). Omit for local dev (file-based).
  TURSO_DB_URL: process.env.TURSO_DB_URL || '',
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN || '',
};
