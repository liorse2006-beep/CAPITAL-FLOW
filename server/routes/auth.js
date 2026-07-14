const express = require('express');
const router = express.Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db');
const {
  hashPassword,
  verifyPassword,
  issueToken,
  withEffectivePremium,
  generateOTP,
  saveOTP,
  verifyOTP,
} = require('../services/auth');
const { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('../services/email');
const { requireAuth } = require('../middleware/authMiddleware');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiters');
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

/* ── Cloudflare Turnstile verification ── */
async function verifyTurnstile(token) {
  const secret = TURNSTILE_SECRET || HCAPTCHA_SECRET; // fallback for legacy env
  if (!secret) return true; // bypass when not configured
  if (!token) return true;  // widget failed to load — degrade gracefully; rate limiter protects
  const params = new URLSearchParams({ secret, response: token });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: params });
  const data = await res.json();
  return data.success === true;
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
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          if (!email) return done(new Error('No email from Google'));

          let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
          if (!user) {
            user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
            if (user) {
              await db.prepare('UPDATE users SET google_id = ?, google_email = ?, is_verified = 1 WHERE id = ?').run(
                profile.id,
                email,
                user.id
              );
              user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
            } else {
              const isPilot = (await pilotAllowlist.isAllowed(email)) ? 1 : 0;
              const tierForGoogle = isPilot ? 'elite' : 'free';
              const result = await db
                .prepare(
                  'INSERT INTO users (email, google_id, google_email, is_verified, is_pilot, tier) VALUES (?, ?, ?, 1, ?, ?)'
                )
                .run(email, profile.id, email, isPilot, tierForGoogle);
              user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
              sendWelcomeEmail(email).catch(() => {});
            }
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
    passport.authenticate('google', { session: false }, async function (err, user, info) {
      if (err) {
        console.error('[google/callback] passport error:', err);
        return res.redirect(`${FRONTEND_URL || 'http://localhost:5173'}/?auth_error=google_failed`);
      }
      if (!user) {
        console.warn('[google/callback] no user returned, info:', info);
        return res.redirect(`${FRONTEND_URL || 'http://localhost:5173'}/?auth_error=google_failed`);
      }
      console.log('[google/callback] success, user id:', user.id, 'email:', user.email);
      const token = await issueToken(user);
      // If FRONTEND_URL is explicitly set use it; otherwise auto-detect from the
      // request host so production works without needing the env var configured.
      const dest = process.env.FRONTEND_URL ||
        (process.env.NODE_ENV === 'production'
          ? `https://${req.get('host')}`
          : 'http://localhost:5173');
      console.log('[google/callback] redirecting to:', dest + '/?google_pending=<JWT>');
      res.redirect(`${dest}/?google_pending=${token}`);
    })(req, res, next);
  });
} else {
  router.get('/google', (req, res) => res.status(503).json({ error: 'Google OAuth not configured' }));
  router.get('/google/callback', (req, res) => res.status(503).json({ error: 'Google OAuth not configured' }));
}

/* ── Sign Up ── */
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, captchaToken, inviteCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

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
      await db.prepare('INSERT INTO users (email, password_hash, is_pilot, tier) VALUES (?, ?, ?, ?)').run(email, hash, isPilot, tier);
    }

    const code = generateOTP();
    await saveOTP(email, code, 'verify_email');
    await sendOTPEmail(email, code);

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('[signup]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Verify OTP (email verification) ── */
router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Missing fields' });

    const result = await verifyOTP(email, code, 'verify_email');
    if (!result.valid) return res.status(400).json({ error: result.reason });

    await db.prepare('UPDATE users SET is_verified = 1 WHERE email = ?').run(email);
    const user = withEffectivePremium(await db.prepare('SELECT * FROM users WHERE email = ?').get(email));
    const token = await issueToken(user);
    sendWelcomeEmail(email).catch(() => {});

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        is_premium: user.is_premium,
        is_pilot: !!user.is_pilot,
        tier: user.tier || 'free',
      },
    });
  } catch (err) {
    console.error('[verify-otp]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Resend OTP ── */
router.post('/resend-otp', authLimiter, async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const otpType = type === 'reset_password' ? 'reset_password' : 'verify_email';
    const code = generateOTP();
    await saveOTP(email, code, otpType);
    if (otpType === 'reset_password') {
      await sendPasswordResetEmail(email, code);
    } else {
      await sendOTPEmail(email, code);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[resend-otp]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Log In ── */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.is_verified) {
      const code = generateOTP();
      await saveOTP(email, code, 'verify_email');
      await sendOTPEmail(email, code);
      return res.status(403).json({ error: 'Email not verified', needsVerification: true, email });
    }

    user = withEffectivePremium(user);
    const token = await issueToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        is_premium: user.is_premium,
        is_pilot: !!user.is_pilot,
        tier: user.tier || 'free',
      },
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Forgot Password ── */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    // Always respond success to avoid email enumeration
    if (user) {
      const code = generateOTP();
      await saveOTP(email, code, 'reset_password');
      await sendPasswordResetEmail(email, code);
    }
    res.json({ success: true, message: 'If that email exists, a reset code was sent' });
  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Reset Password (verify OTP + set new password) ── */
router.post('/reset-password', otpLimiter, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Missing fields' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const result = await verifyOTP(email, code, 'reset_password');
    if (!result.valid) return res.status(400).json({ error: result.reason });

    const hash = await hashPassword(newPassword);
    await db.prepare('UPDATE users SET password_hash = ?, is_verified = 1 WHERE email = ?').run(hash, email);

    const user = withEffectivePremium(await db.prepare('SELECT * FROM users WHERE email = ?').get(email));
    const token = await issueToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        is_premium: user.is_premium,
        is_pilot: !!user.is_pilot,
        tier: user.tier || 'free',
      },
    });
  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Get current user ── */
router.get('/me', requireAuth, (req, res) => {
  const { session_version, ...safeUser } = req.user; // internal-only, never sent to the client
  const user = {
    ...safeUser,
    // SQLite stores these as 0/1 integers — coerce to real booleans so the
    // client never has to guard against a falsy-but-truthy-looking 0
    // leaking into a `value && <Component/>` JSX expression (React renders
    // a bare 0 as the literal text "0").
    is_verified: !!safeUser.is_verified,
    is_premium: !!safeUser.is_premium,
    is_blocked: !!safeUser.is_blocked,
    is_pilot: !!safeUser.is_pilot,
    is_admin: !!(ADMIN_EMAIL && req.user.email === ADMIN_EMAIL),
    tier: safeUser.tier || 'free',
    is_elite: safeUser.tier === 'elite',
  };
  res.json({ user });
});

/* ── Delete account — irreversible, cascades every table that stores data
   keyed to this user (watchlist alerts, push subscriptions, feedback,
   pending OTP codes). Matches the retention promise in the Privacy Policy
   (src/pages/PolicyPage.jsx): deletion is immediate and permanent. ── */
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;

    await db.prepare('DELETE FROM watchlist_alerts WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM feedback WHERE user_id = ?').run(userId);
    if (email) await db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email);
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    res.json({ ok: true });
  } catch (err) {
    console.error('[delete account]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Apply pilot invite (for users who signed in via Google with an invite link) ── */
router.post('/apply-invite', requireAuth, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!PILOT_INVITE_CODE || inviteCode !== PILOT_INVITE_CODE)
      return res.status(400).json({ error: 'Invalid invite code' });
    await db.prepare("UPDATE users SET is_pilot = 1, tier = 'elite' WHERE id = ?").run(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[apply-invite]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Accept pilot confidentiality terms (pilot accounts only) ── */
router.post('/accept-pilot-terms', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_pilot) return res.status(400).json({ error: 'Not a pilot account' });
    await db.prepare('UPDATE users SET pilot_terms_accepted_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000),
      req.user.id
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[accept-pilot-terms]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
