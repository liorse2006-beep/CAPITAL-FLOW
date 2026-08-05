const rateLimit = require('express-rate-limit');

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
// without getting in the way of normal use.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Floor limiter applied to every /api route. Endpoints like /chart and
// /watchlist-quotes had no limit at all before this — an easy vector for a
// script to slowly walk the whole ticker universe and rebuild the dataset.
// Generous enough that no real user in the UI would ever notice it.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
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
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
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
