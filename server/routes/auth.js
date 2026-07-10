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
  FRONTEND_URL,
  ADMIN_EMAIL,
} = require('../config');

// A standard, deliberately simple email shape check. This isn't for
// deliverability — it exists so an arbitrary string (e.g. HTML/script) can
// never be stored as an "email" and later rendered unescaped elsewhere
// (the admin panel renders emails via template strings, not React).
const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;

/* ── hCaptcha verification ── */
async function verifyHCaptcha(token) {
  if (!HCAPTCHA_SECRET) return true; // bypass in dev if not configured
  if (!token) return false;
  const params = new URLSearchParams({ secret: HCAPTCHA_SECRET, response: token });
  const res = await fetch(`https://hcaptcha.com/siteverify`, { method: 'POST', body: params });
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
      function (accessToken, refreshToken, profile, done) {
        const email = profile.emails && profile.emails[0] && profile.emails[0].value;
        if (!email) return done(new Error('No email from Google'));

        let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
        if (!user) {
          user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
          if (user) {
            db.prepare('UPDATE users SET google_id = ?, google_email = ?, is_verified = 1 WHERE id = ?').run(
              profile.id,
              email,
              user.id
            );
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
          } else {
            const isPilot = pilotAllowlist.isAllowed(email) ? 1 : 0;
            const result = db
              .prepare(
                'INSERT INTO users (email, google_id, google_email, is_verified, is_pilot) VALUES (?, ?, ?, 1, ?)'
              )
              .run(email, profile.id, email, isPilot);
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
            sendWelcomeEmail(email).catch(() => {});
          }
        }
        return done(null, user);
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  });

  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));

  router.get('/google/callback', function (req, res, next) {
    passport.authenticate('google', { session: false }, function (err, user, info) {
      if (err) {
        console.error('[google/callback] passport error:', err);
        return res.redirect(`${FRONTEND_URL || 'http://localhost:5173'}/?auth_error=google_failed`);
      }
      if (!user) {
        console.warn('[google/callback] no user returned, info:', info);
        return res.redirect(`${FRONTEND_URL || 'http://localhost:5173'}/?auth_error=google_failed`);
      }
      console.log('[google/callback] success, user id:', user.id, 'email:', user.email);
      const token = issueToken(user);
      const dest = FRONTEND_URL || 'http://localhost:5173';
      console.log('[google/callback] redirecting to:', dest + '/?token=<JWT>');
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
    const { email, password, captchaToken } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const captchaOk = await verifyHCaptcha(captchaToken);
    if (!captchaOk) return res.status(400).json({ error: 'CAPTCHA verification failed' });

    const existing = db.prepare('SELECT id, is_verified FROM users WHERE email = ?').get(email);
    if (existing && existing.is_verified)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const hash = await hashPassword(password);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, email);
    } else {
      const isPilot = pilotAllowlist.isAllowed(email) ? 1 : 0;
      db.prepare('INSERT INTO users (email, password_hash, is_pilot) VALUES (?, ?, ?)').run(email, hash, isPilot);
    }

    const code = generateOTP();
    saveOTP(email, code, 'verify_email');
    await sendOTPEmail(email, code);

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('[signup]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── Verify OTP (email verification) ── */
router.post('/verify-otp', otpLimiter, (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });

  const result = verifyOTP(email, code, 'verify_email');
  if (!result.valid) return res.status(400).json({ error: result.reason });

  db.prepare('UPDATE users SET is_verified = 1 WHERE email = ?').run(email);
  const user = withEffectivePremium(db.prepare('SELECT * FROM users WHERE email = ?').get(email));
  const token = issueToken(user);
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
});

/* ── Resend OTP ── */
router.post('/resend-otp', authLimiter, async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const otpType = type === 'reset_password' ? 'reset_password' : 'verify_email';
    const code = generateOTP();
    saveOTP(email, code, otpType);
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

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.is_verified) {
      const code = generateOTP();
      saveOTP(email, code, 'verify_email');
      await sendOTPEmail(email, code);
      return res.status(403).json({ error: 'Email not verified', needsVerification: true, email });
    }

    user = withEffectivePremium(user);
    const token = issueToken(user);
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

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    // Always respond success to avoid email enumeration
    if (user) {
      const code = generateOTP();
      saveOTP(email, code, 'reset_password');
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

    const result = verifyOTP(email, code, 'reset_password');
    if (!result.valid) return res.status(400).json({ error: result.reason });

    const hash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, is_verified = 1 WHERE email = ?').run(hash, email);

    const user = withEffectivePremium(db.prepare('SELECT * FROM users WHERE email = ?').get(email));
    const token = issueToken(user);
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
router.delete('/account', requireAuth, (req, res) => {
  const userId = req.user.id;
  const email = req.user.email;

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM watchlist_alerts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM feedback WHERE user_id = ?').run(userId);
    if (email) db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  deleteAll();

  res.json({ ok: true });
});

/* ── Accept pilot confidentiality terms (pilot accounts only) ── */
router.post('/accept-pilot-terms', requireAuth, (req, res) => {
  if (!req.user.is_pilot) return res.status(400).json({ error: 'Not a pilot account' });
  db.prepare('UPDATE users SET pilot_terms_accepted_at = ? WHERE id = ?').run(
    Math.floor(Date.now() / 1000),
    req.user.id
  );
  res.json({ ok: true });
});

module.exports = router;
