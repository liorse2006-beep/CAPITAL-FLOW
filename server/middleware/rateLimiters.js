const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { verifyToken } = require('../services/auth');

// Default express-rate-limit keys by IP alone — fine for pre-login
// endpoints (see authLimiter/otpLimiter below, which must stay IP-keyed:
// that's exactly the brute-force surface, and there's no authenticated
// identity yet to key by instead). But for limiters that gate a signed-in
// account's own usage (scans, the API floor, chat), IP-keying means every
// customer behind the same shared IP — an office, a campus, a mobile
// carrier's CGNAT (common in Israel) — draws from ONE shared budget and can
// throttle each other even though each of them individually did nothing
// wrong. Keying by the account instead (when a valid access token is
// present) gives every signed-in customer their own budget; a request with
// no/invalid token still falls back to the IP key, so guests and abuse
// attempts are still covered.
function userOrIpKey(req, res) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = verifyToken(header.slice(7));
      if (payload && payload.id) return 'user:' + payload.id;
    } catch (err) {
      // invalid/expired token — fall through to the IP key below
    }
  }
  // ipKeyGenerator takes the IP string itself (normalizes IPv6 to a /56
  // subnet so one visitor can't dodge the limit across addresses within
  // their own allocated block) — not (req, res).
  return ipKeyGenerator(req.ip);
}

// Tight limiter for credential endpoints — stops brute-force on login,
// signup, OTP verification, and password reset. Keyed by IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Extra-tight limiter specifically for OTP verification — a 6-digit code
// must never be brute-forceable. Small window, few tries.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Request a new code and try again later.' },
});

// Looser limiter for expensive scan/data endpoints — guards against DoS
// without getting in the way of normal use. Keyed by account (see
// userOrIpKey above) so scanning is budgeted per customer, not per shared IP.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests. Please slow down.' },
});

// Floor limiter applied to every /api route. Endpoints like /chart and
// /watchlist-quotes had no limit at all before this — an easy vector for a
// script to slowly walk the whole ticker universe and rebuild the dataset.
// Generous enough that no real user in the UI would ever notice it. Keyed
// by account for the same reason as scanLimiter.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests. Please slow down.' },
});

// The admin router is mounted at "/", not "/api", so it never gets the
// apiLimiter floor — without its own limiter, ADMIN_TOKEN would be
// brute-forceable with zero throttling.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Capi (chat) calls a metered external API — this is tighter than
// scanLimiter to keep one chatty user from burning through the app-wide
// daily Gemini quota (see services/chatbot.js's own DAILY_CALL_CAP too).
// Keyed by account for the same reason as scanLimiter.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many messages. Please slow down.' },
});

// Public endpoints that write data or trigger provider work need a tighter
// limit than the general API floor. This is keyed by the trusted proxy IP.
const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

const publicDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// /api/auth/refresh and /api/auth/logout aren't brute-forceable the way
// login is (the refresh token itself is a 384-bit random value, not a
// guessable credential) but every other credential-adjacent endpoint has a
// dedicated limiter, and a compromised/buggy client hammering refresh in a
// loop shouldn't have only the generic 120/min apiLimiter floor standing in
// the way. Sized well above realistic multi-device/multi-tab usage.
const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

module.exports = {
  authLimiter,
  otpLimiter,
  scanLimiter,
  apiLimiter,
  adminLimiter,
  chatLimiter,
  publicWriteLimiter,
  publicDataLimiter,
  sessionLimiter,
};
