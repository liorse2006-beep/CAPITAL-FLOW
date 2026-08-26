const express = require('express');
const { reportError } = require('../utils/reportError');
const router = express.Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db');
const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  issueToken,
  refreshAccessToken,
  revokeSession,
  revokeAllSessions,
  withEffectivePremium,
  generateOTP,
  saveOTP,
  verifyOTP,
  verifyToken,
  MAX_PASSWORD_BYTES,
} = require('../services/auth');
const {
  sendOTPEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendNewSignupAdminAlert,
} = require('../services/email');
const { requireAuth, invalidateUserSessions } = require('../middleware/authMiddleware');
const { eliteAccess } = require('../services/scanQuota');
const { authLimiter, otpLimiter, sessionLimiter } = require('../middleware/rateLimiters');
const crypto = require('crypto');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const pilotAllowlist = require('../services/pilotAllowlist');
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
  HCAPTCHA_SECRET,
  TURNSTILE_SECRET,
  PILOT_INVITE_CODE,
  FRONTEND_URL,
  ADMIN_EMAIL,
} = require('../config');

// A standard, deliberately simple email shape check. This isn't for
// deliverability — it exists so an arbitrary string (e.g. HTML/script) can
// never be stored as an "email" and later rendered unescaped elsewhere
// (the admin panel renders emails via template strings, not React).
const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
const MAX_EMAIL_BYTES = 254;

function isValidEmailShape(email) {
  return Buffer.byteLength(email, 'utf8') <= MAX_EMAIL_BYTES && EMAIL_RE.test(email);
}

// A real bcrypt hash of an arbitrary, unguessable string — never a valid
// password for any account. /login compares against this when the email
// doesn't exist so bcrypt.compare() always runs and always takes the same
// ~80-120ms either way, closing the timing side-channel that let an
// attacker distinguish "email exists" from "email doesn't exist" by
// response latency alone (the account-existence check itself already
// returns the same generic error message, but skipping the compare
// entirely was still visible in timing).
const DUMMY_PASSWORD_HASH = '$2b$12$6o2c9QdDPpVJDkrxAXyZNOtcbhFwjkkB111QkvJjk3HneG7iZSYXy';

// The refresh token is what actually keeps a device "logged in forever"
// (until an explicit logout, or eviction past the 2-device cap) — httpOnly
// so no injected script can ever read it, scoped to /api/auth so it's never
// sent on every other API request, and long-lived enough that closing the
// app for days doesn't matter.
const REFRESH_COOKIE_NAME = 'vs_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

function isConfiguredAdmin(email) {
  return !!ADMIN_EMAIL && String(email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// Keep the browser-facing user object deliberately allow-listed. The auth
// middleware reads the complete database row because server-side feature
// gates need it, but password hashes, provider identifiers and internal
// conversation/session fields must never cross the API boundary.
function serializePublicUser(user) {
  const effective = withEffectivePremium(user || {});
  return {
    id: effective.id,
    email: effective.email,
    avatar_url: effective.avatar_url || null,
    auth_provider: effective.google_id ? 'Google' : effective.password_hash ? 'Email and password' : 'Unknown',
    created_at: effective.created_at || null,
    last_login_at: effective.last_login_at || null,
    is_verified: !!effective.is_verified,
    is_premium: !!effective.is_premium,
    is_pilot: !!effective.is_pilot,
    is_admin: isConfiguredAdmin(effective.email),
    tier: effective.tier || 'free',
    is_elite: effective.tier === 'elite',
    elite_access: eliteAccess(effective),
    pilot_terms_accepted_at: effective.pilot_terms_accepted_at || null,
    notification_time: effective.notification_time || null,
    free_scan_count: effective.free_scan_count || 0,
    free_scan_used_capital_flow: effective.free_scan_used_capital_flow || 0,
    free_scan_used_ma_scanner: effective.free_scan_used_ma_scanner || 0,
    free_scan_used_sector_moving: effective.free_scan_used_sector_moving || 0,
    premium_scan_count: effective.premium_scan_count || 0,
    premium_scan_window_start: effective.premium_scan_window_start || null,
  };
}

// Google profile photos are the only external avatar source accepted here.
// Keep the value constrained to Google's HTTPS image hosts so a profile row
// can never turn into an arbitrary remote URL that the client would render.
function getGoogleAvatarUrl(profile) {
  const raw = profile && profile.photos && profile.photos[0] && profile.photos[0].value;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/^lh\d+\.googleusercontent\.com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
}

/* ── Cloudflare Turnstile verification ── */
async function verifyTurnstile(token) {
  const secret = TURNSTILE_SECRET || HCAPTCHA_SECRET; // fallback for legacy env
  if (!secret) return true; // bypass when not configured
  // Once a secret is configured, a missing token is a hard failure — the
  // old "degrade gracefully" path meant any bot could skip the CAPTCHA
  // entirely by simply not sending one, leaving the rate limiter as the
  // only signup protection.
  if (!token) return false;
  const params = new URLSearchParams({ secret, response: token });
  try {
    const res = await fetchWithTimeout('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    // A hung/failed Turnstile call must fail closed (reject the signup),
    // not hang the request forever — the old bare fetch() had no timeout.
    reportError(err, '[verifyTurnstile]');
    return false;
  }
}

/* ── Google OAuth ── */
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback',
      },
      async function (accessToken, refreshToken, profile, done) {
        try {
          const email = normalizeEmail(profile.emails && profile.emails[0] && profile.emails[0].value);
          if (!email) return done(new Error('No email from Google'));
          const avatarUrl = getGoogleAvatarUrl(profile);

          let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
          if (!user) {
            user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
            if (user) {
              await db
                .prepare(
                  'UPDATE users SET google_id = ?, google_email = ?, avatar_url = COALESCE(?, avatar_url), is_verified = 1 WHERE id = ?'
                )
                .run(profile.id, email, avatarUrl, user.id);
              user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
            } else {
              const isPilot = (await pilotAllowlist.isAllowed(email)) ? 1 : 0;
              const tierForGoogle = isPilot ? 'elite' : 'free';
              const result = await db
                .prepare(
                  'INSERT INTO users (email, google_id, google_email, avatar_url, is_verified, is_pilot, tier) VALUES (?, ?, ?, ?, 1, ?, ?)'
                )
                .run(email, profile.id, email, avatarUrl, isPilot, tierForGoogle);
              user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
              sendWelcomeEmail(email).catch((err) => reportError(err, '[welcome-email]'));
              sendNewSignupAdminAlert(email, 'Google').catch((err) => reportError(err, '[admin-alert]'));
            }
          }
          // Refresh the image when Google changes it, while preserving the
          // last known image if Google temporarily omits a photo.
          if (user && avatarUrl && user.avatar_url !== avatarUrl) {
            await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, user.id);
            user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));

  router.get('/google/callback', function (req, res, next) {
    passport.authenticate('google', { session: false }, async function (err, user, _info) {
      if (err) {
        reportError(err, '[google/callback] passport error');
        return res.redirect(`${FRONTEND_URL || 'http://localhost:5173'}/?auth_error=google_failed`);
      }
      if (!user) {
        console.warn('[google/callback] provider did not return an authenticated user');
        return res.redirect(`${FRONTEND_URL || 'http://localhost:5173'}/?auth_error=google_failed`);
      }
      console.log('[google/callback] authentication succeeded');
      const { accessToken, refreshToken } = await issueToken(user);
      setRefreshCookie(res, refreshToken);
      // If FRONTEND_URL is explicitly set use it; otherwise auto-detect from the
      // request host so production works without needing the env var configured.
      const dest =
        process.env.FRONTEND_URL ||
        (process.env.NODE_ENV === 'production' ? `https://${req.get('host')}` : 'http://localhost:5173');
      console.log('[google/callback] redirecting to configured frontend');
      // A URL fragment (#...), not a query string (?...) — the browser never
      // sends the fragment to any server (this one included, on the very
      // next request) and strips it from the Referer header on any outbound
      // request the landing page makes before React mounts. A query string
      // has neither protection: it travels in this redirect's own request
      // line (so it can end up in this server's/a reverse proxy's access
      // log) and rides along in Referer to any third-party resource the page
      // loads before the token is read out of the URL.
      res.redirect(`${dest}/#google_pending=${accessToken}`);
    })(req, res, next);
  });
} else {
  router.get('/google', (req, res) => res.status(503).json({ error: 'Google OAuth not configured' }));
  router.get('/google/callback', (req, res) => res.status(503).json({ error: 'Google OAuth not configured' }));
}

/* ── Sign Up ── */
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { password, captchaToken, inviteCode } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!email || typeof password !== 'string' || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    if (!isValidEmailShape(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES)
      return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes` });

    const captchaOk = await verifyTurnstile(captchaToken);
    if (!captchaOk) return res.status(400).json({ error: 'CAPTCHA verification failed' });

    const existing = await db.prepare('SELECT id, is_verified FROM users WHERE email = ?').get(email);
    if (existing && existing.is_verified)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const isPilotByInvite = PILOT_INVITE_CODE && inviteCode === PILOT_INVITE_CODE ? 1 : 0;
    const hash = await hashPassword(password);
    if (existing) {
      await db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, email);
      if (isPilotByInvite) {
        await db.prepare("UPDATE users SET is_pilot = 1, tier = 'elite' WHERE email = ?").run(email);
      }
    } else {
      const isPilotByAllowlist = (await pilotAllowlist.isAllowed(email)) ? 1 : 0;
      const isPilot = isPilotByInvite || isPilotByAllowlist;
      const tier = isPilot ? 'elite' : 'free';
      await db
        .prepare('INSERT INTO users (email, password_hash, is_pilot, tier) VALUES (?, ?, ?, ?)')
        .run(email, hash, isPilot, tier);
    }

    const code = generateOTP();
    await saveOTP(email, code, 'verify_email');
    await sendOTPEmail(email, code);

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (err) {
    reportError(err, '[signup]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Verify OTP (email verification) ── */
router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!email || !isValidEmailShape(email) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid verification details' });
    }

    const result = await verifyOTP(email, code, 'verify_email');
    if (!result.valid) return res.status(400).json({ error: result.reason });

    // Fetch before the UPDATE so we can tell a brand-new signup (never
    // verified before) apart from an already-verified account re-running
    // this endpoint — the admin alert should fire once, not on every call.
    const wasAlreadyVerified = (await db.prepare('SELECT is_verified FROM users WHERE email = ?').get(email))
      ?.is_verified;

    await db.prepare('UPDATE users SET is_verified = 1 WHERE email = ?').run(email);
    const user = withEffectivePremium(await db.prepare('SELECT * FROM users WHERE email = ?').get(email));
    const { accessToken, refreshToken } = await issueToken(user);
    setRefreshCookie(res, refreshToken);
    sendWelcomeEmail(email).catch((err) => reportError(err, '[welcome-email]'));
    if (!wasAlreadyVerified) sendNewSignupAdminAlert(email, 'email').catch((err) => reportError(err, '[admin-alert]'));

    res.json({
      success: true,
      token: accessToken,
      user: serializePublicUser(user),
    });
  } catch (err) {
    reportError(err, '[verify-otp]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Resend OTP ── */
router.post('/resend-otp', authLimiter, async (req, res) => {
  try {
    const { type } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!email || !isValidEmailShape(email)) return res.status(400).json({ error: 'Invalid email address' });
    const otpType = type === 'reset_password' ? 'reset_password' : 'verify_email';
    // Only send to addresses with an actual account — otherwise this endpoint
    // is an open relay for spamming/email-bombing arbitrary inboxes. Still
    // reply success either way to avoid leaking which emails are registered.
    const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (user) {
      const code = generateOTP();
      await saveOTP(email, code, otpType);
      if (otpType === 'reset_password') {
        await sendPasswordResetEmail(email, code);
      } else {
        await sendOTPEmail(email, code);
      }
    }
    res.json({ success: true });
  } catch (err) {
    reportError(err, '[resend-otp]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Log In ── */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!email || typeof password !== 'string' || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    if (!isValidEmailShape(email)) return res.status(401).json({ error: 'Invalid email or password' });
    // Do not run bcrypt on inputs it can never match. Return the same generic
    // authentication error used for a wrong password to avoid exposing policy
    // details or an account-existence oracle.
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES)
      return res.status(401).json({ error: 'Invalid email or password' });

    let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Always run bcrypt.compare, even for an unknown email or a Google-only
    // account with no password_hash — against DUMMY_PASSWORD_HASH in that
    // case — so this branch takes the same time either way.
    const ok = await verifyPassword(password, (user && user.password_hash) || DUMMY_PASSWORD_HASH);
    if (!user || !user.password_hash || !ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.is_verified) {
      const code = generateOTP();
      await saveOTP(email, code, 'verify_email');
      await sendOTPEmail(email, code);
      return res.status(403).json({ error: 'Email not verified', needsVerification: true, email });
    }

    user = withEffectivePremium(user);
    const { accessToken, refreshToken } = await issueToken(user);
    setRefreshCookie(res, refreshToken);
    res.json({
      success: true,
      token: accessToken,
      user: serializePublicUser(user),
    });
  } catch (err) {
    reportError(err, '[login]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Forgot Password ── */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !isValidEmailShape(email)) return res.status(400).json({ error: 'Invalid email address' });

    const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    // Always respond success to avoid email enumeration
    if (user) {
      const code = generateOTP();
      await saveOTP(email, code, 'reset_password');
      await sendPasswordResetEmail(email, code);
    }
    res.json({ success: true, message: 'If that email exists, a reset code was sent' });
  } catch (err) {
    reportError(err, '[forgot-password]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Reset Password (verify OTP + set new password) ── */
router.post('/reset-password', otpLimiter, async (req, res) => {
  try {
    const { code, newPassword } = req.body;
    const email = normalizeEmail(req.body.email);
    if (
      !email ||
      !isValidEmailShape(email) ||
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code) ||
      typeof newPassword !== 'string' ||
      !newPassword
    )
      return res.status(400).json({ error: 'Missing fields' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (Buffer.byteLength(newPassword, 'utf8') > MAX_PASSWORD_BYTES)
      return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes` });

    const result = await verifyOTP(email, code, 'reset_password');
    if (!result.valid) return res.status(400).json({ error: result.reason });

    const hash = await hashPassword(newPassword);
    await db.prepare('UPDATE users SET password_hash = ?, is_verified = 1 WHERE email = ?').run(hash, email);

    const user = withEffectivePremium(await db.prepare('SELECT * FROM users WHERE email = ?').get(email));
    // A password reset is the standard "I think my account/session may be
    // compromised" recovery flow — every existing device session (including
    // a stolen refresh token an attacker is holding) must end here, not just
    // continue quietly alongside the new one issueToken is about to create.
    await revokeAllSessions(user.id);
    const { accessToken, refreshToken } = await issueToken(user);
    setRefreshCookie(res, refreshToken);
    res.json({
      success: true,
      token: accessToken,
      user: serializePublicUser(user),
    });
  } catch (err) {
    reportError(err, '[reset-password]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Silently exchange the httpOnly refresh cookie for a new access token —
   this is what lets a device stay "logged in" across the access token's 1h
   expiry, including after the app was closed for hours or days, without the
   user ever seeing a login screen. Fails (401) once the session has been
   explicitly logged out or evicted by a 3rd device logging in. ── */
router.post('/refresh', sessionLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE_NAME];
    const result = await refreshAccessToken(refreshToken);
    if (!result) return res.status(401).json({ error: 'No active session' });
    res.json({ success: true, token: result.accessToken });
  } catch (err) {
    reportError(err, '[refresh]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Log out this device only — every other device's session (up to the
   2-device cap) is left untouched, unlike the old scheme where any login
   anywhere ended every other device's session. ── */
router.post('/logout', sessionLimiter, requireAuth, async (req, res) => {
  try {
    const payload = verifyToken(req.headers.authorization.slice(7));
    await revokeSession(payload.sid, req.user.id);
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[logout]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Get current user ── */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: serializePublicUser(req.user) });
});

/* ── Delete account — irreversible, cascades every table that stores data
   keyed to this user (watchlist alerts, push subscriptions, feedback,
   pending OTP codes). Matches the retention promise in the Privacy Policy
   (src/pages/PolicyPage.jsx): deletion is immediate and permanent. ── */
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;

    const statements = [
      'user_sessions',
      'watchlist_alerts',
      'watchlist',
      'push_subscriptions',
      'feedback',
      'scheduled_scans',
      'notifications',
      'chat_messages',
      'ai_usage',
    ].map((table) => ({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] }));
    statements.push(
      {
        sql: 'DELETE FROM radar_schedule_runs WHERE radar_id IN (SELECT id FROM capital_flow_radars WHERE user_id = ?)',
        args: [userId],
      },
      { sql: 'DELETE FROM radar_events WHERE user_id = ?', args: [userId] },
      {
        sql: 'DELETE FROM radar_states WHERE radar_id IN (SELECT id FROM capital_flow_radars WHERE user_id = ?)',
        args: [userId],
      },
      { sql: 'DELETE FROM capital_flow_radars WHERE user_id = ?', args: [userId] }
    );
    if (email) statements.push({ sql: 'DELETE FROM otp_codes WHERE email = ?', args: [email] });
    statements.push({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] });
    await db.transaction(statements);

    // The transaction removes the durable rows; this invalidates any cached
    // JWT resolution immediately and clears this browser's refresh cookie.
    invalidateUserSessions(userId);
    clearRefreshCookie(res);

    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[delete account]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Apply pilot invite (for users who signed in via Google with an invite link) ──
   authLimiter (10 attempts / 15 min / IP) makes this endpoint as brute-force
   resistant as login/signup — without it, a signed-in attacker could guess
   PILOT_INVITE_CODE at the generic apiLimiter's 120 req/min and grant
   themselves permanent free Elite access. The comparison is also
   timing-safe, matching verifyOTP's pattern, so response latency can't leak
   how many characters of a guess were correct. */
router.post('/apply-invite', authLimiter, requireAuth, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const supplied = Buffer.from(String(inviteCode || ''));
    const expected = Buffer.from(String(PILOT_INVITE_CODE || ''));
    if (supplied.length > 128 || expected.length > 128) return res.status(400).json({ error: 'Invalid invite code' });
    const matches =
      !!PILOT_INVITE_CODE && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!matches) return res.status(400).json({ error: 'Invalid invite code' });
    await db.prepare("UPDATE users SET is_pilot = 1, tier = 'elite' WHERE id = ?").run(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[apply-invite]');
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Accept pilot confidentiality terms (pilot accounts only) ── */
router.post('/accept-pilot-terms', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_pilot) return res.status(400).json({ error: 'Not a pilot account' });
    await db
      .prepare('UPDATE users SET pilot_terms_accepted_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[accept-pilot-terms]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.setRefreshCookie = setRefreshCookie;
module.exports.clearRefreshCookie = clearRefreshCookie;
module.exports.serializePublicUser = serializePublicUser;
module.exports.getGoogleAvatarUrl = getGoogleAvatarUrl;
