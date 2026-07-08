const rateLimit = require('express-rate-limit');

// Tight limiter for credential endpoints — stops brute-force on login,
// signup, OTP verification, and password reset. Keyed by IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per IP per window
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

module.exports = { authLimiter, otpLimiter, scanLimiter, apiLimiter, adminLimiter };
