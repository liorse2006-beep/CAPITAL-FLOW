require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Render's env var editor uses a <textarea> for values, so a stray Enter
// keystroke (or a paste that includes one) silently bakes a trailing "\n"
// into the stored value — invisible in the UI, but fatal the moment it ends
// up in something like a redirect Location header. Trim every value at the
// source so this class of bug can't leak past config.js.
function env(name, fallback = '') {
  const val = process.env[name];
  return val === undefined ? fallback : val.trim();
}

// ── Fail-closed on missing auth secrets ────────────────────────────────────
// A weak/guessable JWT secret lets anyone forge an admin token. Rather than
// silently fall back to a public default, refuse to boot. This guarantees the
// forged-token vulnerability can never recur, in any environment.
const INSECURE = new Set(['', 'dev-secret-change-in-production', 'dev-session-secret', 'secret', 'changeme']);
function requireSecret(name) {
  const val = env(name);
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
const rawAdminToken = env('ADMIN_TOKEN');
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
  FINNHUB_API_KEY: env('FINNHUB_API_KEY'),
  // Extra Finnhub accounts for automatic rotation/failover — see services/finnhubKeyPool.js
  FINNHUB_API_KEY_POOL: [1, 2, 3, 4].map((i) => env('FINNHUB_API_KEY_POOL_' + i)).filter(Boolean),
  // Per-symbol news fallback chain — see services/newsService.js
  MASSIVE_API_KEY: env('MASSIVE_API_KEY'),
  MARKETAUX_API_KEY: env('MARKETAUX_API_KEY'),
  NEWSDATA_API_KEY: env('NEWSDATA_API_KEY'),
  GOOGLE_AI_STUDIO_KEY: env('GOOGLE_AI_STUDIO_KEY'),
  VAPID_PUBLIC_KEY: env('VAPID_PUBLIC_KEY'),
  VAPID_PRIVATE_KEY: env('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT: env('VAPID_SUBJECT'),
  JWT_SECRET: requireSecret('JWT_SECRET'),
  GMAIL_USER: env('GMAIL_USER'),
  GMAIL_APP_PASSWORD: env('GMAIL_APP_PASSWORD'),
  // Resend — the transactional email provider for everything user-facing
  // (OTP, password reset, welcome, admin signup alerts). Gmail SMTP above
  // stays wired up only for the daily DB backup, which has its own sender.
  RESEND_API_KEY: env('RESEND_API_KEY'),
  RESEND_FROM_EMAIL: env('RESEND_FROM_EMAIL', 'Capital Flow <onboarding@resend.dev>'),
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
  GOOGLE_CALLBACK_URL: env('GOOGLE_CALLBACK_URL', 'http://localhost:3001/api/auth/google/callback'),
  HCAPTCHA_SECRET: env('HCAPTCHA_SECRET'),
  TURNSTILE_SECRET: env('TURNSTILE_SECRET'),
  FRONTEND_URL: env('FRONTEND_URL', 'http://localhost:5173'),
  SESSION_SECRET: requireSecret('SESSION_SECRET'),
  ADMIN_TOKEN: env('ADMIN_TOKEN'),
  ADMIN_EMAIL: env('ADMIN_EMAIL'),
  OPENROUTER_API_KEY: env('OPENROUTER_API_KEY'),
  SENTRY_DSN: env('SENTRY_DSN'),
  // Whop (checkout) — opt-in, same pattern as Sentry: features that depend
  // on these simply no-op until they're set.
  WHOP_API_KEY: env('WHOP_API_KEY'),
  WHOP_WEBHOOK_SECRET: env('WHOP_WEBHOOK_SECRET'),
  WHOP_PREMIUM_PLAN_ID: env('WHOP_PREMIUM_PLAN_ID'),
  WHOP_ELITE_PLAN_ID: env('WHOP_ELITE_PLAN_ID'),
  // A separate, half-price Whop plan offered exactly once — on the Premium
  // welcome screen, right after purchase. See routes/checkout.js: only an
  // account that is CURRENTLY on Premium can start a checkout against this
  // plan, which is what makes the offer genuinely exclusive rather than a
  // copy-only claim. Leave unset to hide the offer entirely.
  WHOP_ELITE_UPGRADE_PLAN_ID: env('WHOP_ELITE_UPGRADE_PLAN_ID'),
  // Turso cloud SQLite — set for production (Koyeb). Omit for local dev (file-based).
  TURSO_DB_URL: env('TURSO_DB_URL'),
  TURSO_AUTH_TOKEN: env('TURSO_AUTH_TOKEN'),
  PILOT_INVITE_CODE: env('PILOT_INVITE_CODE'),
};

// Google OAuth is enabled (routes/auth.js wires up the passport strategy)
// the moment GOOGLE_CLIENT_ID/SECRET are set — but the callback URL Google
// redirects back to after login silently defaults to localhost:3001 if
// GOOGLE_CALLBACK_URL isn't also set. In production that means every real
// "Sign in with Google" attempt completes the Google-side auth and then
// redirects the user's browser to localhost, where nothing is listening —
// a completely broken login flow with no error anywhere pointing at the
// cause. Fail loudly at boot instead of discovering this from a support
// ticket. NODE_ENV=production is set explicitly in the Dockerfile.
if (
  process.env.NODE_ENV === 'production' &&
  module.exports.GOOGLE_CLIENT_ID &&
  module.exports.GOOGLE_CLIENT_SECRET &&
  !process.env.GOOGLE_CALLBACK_URL
) {
  console.error(
    '\n[FATAL] GOOGLE_CLIENT_ID/SECRET are set but GOOGLE_CALLBACK_URL is not — Google login would silently ' +
      'redirect users to http://localhost:3001 in production. Set GOOGLE_CALLBACK_URL to this server\'s real ' +
      'public callback URL (e.g. https://your-domain.com/api/auth/google/callback) before starting.\n'
  );
  process.exit(1);
}

// Without RESEND_API_KEY, services/email.js silently falls back to
// console.log-ing OTP/password-reset codes in plaintext instead of emailing
// them — correct for local dev, but in production that means every signup
// and password-reset code ends up sitting in plaintext server logs (visible
// to anyone with log access, retained indefinitely, potentially forwarded to
// a third-party log aggregator) instead of reaching only the account owner's
// inbox. Fail loudly at boot rather than discovering this from a leaked log.
if (process.env.NODE_ENV === 'production' && !module.exports.RESEND_API_KEY) {
  console.error(
    '\n[FATAL] RESEND_API_KEY is not set — in production this would silently print OTP and password-reset ' +
      'codes in plaintext to server logs instead of emailing them. Set RESEND_API_KEY before starting.\n'
  );
  process.exit(1);
}
