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

// The independent status service deliberately has no user-authentication
// surface and stores no application users. Do not make it depend on the main
// app's JWT/session secrets just to load the shared configuration module.
// The main application still fails closed for both secrets.
function appSecret(name) {
  return process.env.INDEPENDENT_STATUS_SERVICE === 'true' ? env(name) : requireSecret(name);
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

const rawStatusAdminToken = env('STATUS_ADMIN_TOKEN');
if (rawStatusAdminToken && (INSECURE.has(rawStatusAdminToken) || rawStatusAdminToken.length < 32)) {
  console.error(
    `\n[FATAL] STATUS_ADMIN_TOKEN is set but too weak (${rawStatusAdminToken.length} chars). ` +
      'It grants status operations access — set a strong value (≥32 chars) or unset it entirely.\n'
  );
  process.exit(1);
}

// The status monitor uses this secret only to prove that the request reaching
// the main app really came from the independent monitor.  Treat it like an
// operational credential: an omitted or weak value would make the protected
// market-data probe fail closed and be misreported as a customer-facing data
// outage.  Production must therefore never start without a strong value.
const rawStatusInternalToken = env('STATUS_INTERNAL_TOKEN');
if (rawStatusInternalToken && (INSECURE.has(rawStatusInternalToken) || rawStatusInternalToken.length < 32)) {
  console.error(
    `\n[FATAL] STATUS_INTERNAL_TOKEN is set but too weak (${rawStatusInternalToken.length} chars). ` +
      'Set the same strong value on the main application and the independent status service.\n'
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
  JWT_SECRET: appSecret('JWT_SECRET'),
  GMAIL_USER: env('GMAIL_USER'),
  GMAIL_APP_PASSWORD: env('GMAIL_APP_PASSWORD'),
  // Resend — the transactional email provider for everything user-facing
  // (OTP, password reset, welcome, admin signup alerts). Gmail SMTP above
  // stays wired up only for the weekly DB backup, which has its own sender.
  RESEND_API_KEY: env('RESEND_API_KEY'),
  RESEND_FROM_EMAIL: env('RESEND_FROM_EMAIL', 'Capital Flow <onboarding@resend.dev>'),
  GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
  // The production domain is fixed for this deployment. Keeping the safe
  // public callback as the production default prevents a Render boot loop
  // when OAuth credentials exist but the optional dashboard variable was
  // omitted; local development keeps its localhost default.
  GOOGLE_CALLBACK_URL: env(
    'GOOGLE_CALLBACK_URL',
    process.env.NODE_ENV === 'production'
      ? 'https://capitalflow.vip/api/auth/google/callback'
      : 'http://localhost:3001/api/auth/google/callback'
  ),
  HCAPTCHA_SECRET: env('HCAPTCHA_SECRET'),
  TURNSTILE_SECRET: env('TURNSTILE_SECRET'),
  FRONTEND_URL: env('FRONTEND_URL', 'http://localhost:5173'),
  // Status monitoring is intentionally configurable independently from the
  // app's normal frontend URL. In production this should point at the public
  // origin that an external worker checks, not at localhost.
  STATUS_TARGET_URL: env('STATUS_TARGET_URL'),
  STATUS_PUBLIC_URL: env('STATUS_PUBLIC_URL'),
  STATUS_FULL_ADMIN_URL: env('STATUS_FULL_ADMIN_URL'),
  STATUS_ALERT_RECIPIENTS: env('STATUS_ALERT_RECIPIENTS'),
  STATUS_INTERNAL_TOKEN: rawStatusInternalToken,
  STATUS_ADMIN_TOKEN: env('STATUS_ADMIN_TOKEN'),
  STATUS_MONITOR_ENABLED: env('STATUS_MONITOR_ENABLED', 'true').toLowerCase() !== 'false',
  STATUS_CHECK_INTERVAL_MS: Math.max(
    60 * 1000,
    parseInt(env('STATUS_CHECK_INTERVAL_MS', String(5 * 60 * 1000)), 10) || 5 * 60 * 1000
  ),
  STATUS_CHECK_TIMEOUT_MS: Math.max(1000, parseInt(env('STATUS_CHECK_TIMEOUT_MS', '8000'), 10) || 8000),
  STATUS_RETRY_DELAY_MS: Math.max(250, parseInt(env('STATUS_RETRY_DELAY_MS', '1200'), 10) || 1200),
  STATUS_FAILURE_CONFIRMATIONS: Math.max(1, parseInt(env('STATUS_FAILURE_CONFIRMATIONS', '2'), 10) || 2),
  STATUS_RECOVERY_CONFIRMATIONS: Math.max(1, parseInt(env('STATUS_RECOVERY_CONFIRMATIONS', '2'), 10) || 2),
  STATUS_RAW_RETENTION_DAYS: Math.max(7, parseInt(env('STATUS_RAW_RETENTION_DAYS', '180'), 10) || 180),
  // The independent status host must detect a monitor that has stopped
  // advancing even when its process and database are still reachable.
  STATUS_HEARTBEAT_STALE_MULTIPLIER: Math.max(1.5, parseFloat(env('STATUS_HEARTBEAT_STALE_MULTIPLIER', '2')) || 2),
  STATUS_WATCHDOG_INTERVAL_MS: Math.max(15 * 1000, parseInt(env('STATUS_WATCHDOG_INTERVAL_MS', '60000'), 10) || 60000),
  // Status backups are disabled by default. The primary application backup
  // is the only scheduled email backup; enabling this opt-in would create a
  // second operational backup stream for the independent status database.
  STATUS_BACKUP_ENABLED: env('STATUS_BACKUP_ENABLED', 'false').toLowerCase() !== 'false',
  STATUS_BACKUP_INTERVAL_MS: Math.max(
    60 * 60 * 1000,
    parseInt(env('STATUS_BACKUP_INTERVAL_MS', String(24 * 60 * 60 * 1000)), 10) || 24 * 60 * 60 * 1000
  ),
  STATUS_BACKUP_RECIPIENTS: env('STATUS_BACKUP_RECIPIENTS'),
  STATUS_BACKUP_MAX_BYTES: Math.max(
    1024 * 1024,
    parseInt(env('STATUS_BACKUP_MAX_BYTES', String(20 * 1024 * 1024)), 10) || 20 * 1024 * 1024
  ),
  SESSION_SECRET: appSecret('SESSION_SECRET'),
  ADMIN_TOKEN: env('ADMIN_TOKEN'),
  ADMIN_EMAIL: env('ADMIN_EMAIL'),
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
  // Turso cloud SQLite — set for production (Render). Omit for local dev (file-based).
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
  !module.exports.GOOGLE_CALLBACK_URL
) {
  console.error(
    '\n[FATAL] GOOGLE_CLIENT_ID/SECRET are set but GOOGLE_CALLBACK_URL is not — Google login would silently ' +
      "redirect users to http://localhost:3001 in production. Set GOOGLE_CALLBACK_URL to this server's real " +
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

// A production status host cannot validate the real market-data flow without
// this shared probe credential.  Fail at boot instead of leaving a running
// website with a permanently false SEV-2 incident on the public status page.
if (process.env.NODE_ENV === 'production' && !module.exports.STATUS_INTERNAL_TOKEN) {
  console.error(
    '\n[FATAL] STATUS_INTERNAL_TOKEN is not set — the protected market-data probe would fail and create a false ' +
      'status incident. Set one strong identical value on the main app and independent status service before starting.\n'
  );
  process.exit(1);
}

// Production must never silently fall back to the local SQLite file. That
// fallback is useful for development, but on a redeploy or a fresh container
// it would create an apparently healthy main application with a new empty
// database and no durable user data. Require both Turso coordinates for the
// main application; the independent status service may explicitly opt into
// its currently configured file-backed store without weakening the main app.
const statusFileDatabaseAllowed =
  process.env.INDEPENDENT_STATUS_SERVICE === 'true' &&
  process.env.STATUS_ALLOW_FILE_DB === 'true' &&
  /^file:/i.test(String(module.exports.TURSO_DB_URL || ''));
if (
  process.env.NODE_ENV === 'production' &&
  (!module.exports.TURSO_DB_URL || (!module.exports.TURSO_AUTH_TOKEN && !statusFileDatabaseAllowed))
) {
  console.error(
    '\n[FATAL] TURSO_DB_URL and TURSO_AUTH_TOKEN are required in production. ' +
      'Refusing to start against a local SQLite database; configure the durable production database first.\n'
  );
  process.exit(1);
}
