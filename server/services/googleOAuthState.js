const crypto = require('crypto');

// A signed browser cookie is not a one-time store: an old cookie can be
// replayed. Keep the verifier and consumed-state ledger on the one HTTP
// instance, bound to this browser and the exact provider/callback. A restart
// fails pending sign-ins closed; the customer can safely start a new sign-in.
function createGoogleOAuthStateStore({
  now = Date.now,
  ttlMs = 10 * 60 * 1000,
  capacity = 2000,
  perBrowserCapacity = 8,
} = {}) {
  const records = new Map();
  const sessionKey = 'googleOAuthBrowserBinding';
  function prune() {
    for (const [state, record] of records) if (record.expiresAt <= now()) records.delete(state);
  }
  function providerBinding(meta) {
    return JSON.stringify([meta.authorizationURL, meta.tokenURL, meta.clientID, meta.callbackURL]);
  }
  return {
    // Passport dispatches by arity; do not change these signatures.
    store(req, verifier, _applicationState, meta, done) {
      if (!req.session) return done(new Error('Sign-in session unavailable'));
      prune();
      if (records.size >= capacity || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
        return done(new Error('Sign-in temporarily unavailable'));
      }
      if (!/^[a-f0-9]{64}$/.test(req.session[sessionKey] || ''))
        req.session[sessionKey] = crypto.randomBytes(32).toString('hex');
      let browserRecords = 0;
      for (const record of records.values()) if (record.browser === req.session[sessionKey]) browserRecords++;
      if (browserRecords >= perBrowserCapacity) return done(new Error('Sign-in temporarily unavailable'));
      // Changing only this non-secret marker renews cookie-session's expiry
      // without invalidating other outstanding tabs bound to this browser.
      req.session.googleOAuthCookieRenewal = crypto.randomBytes(8).toString('hex');
      const state = crypto.randomBytes(32).toString('base64url');
      records.set(state, {
        browser: req.session[sessionKey],
        verifier,
        provider: providerBinding(meta),
        expiresAt: now() + ttlMs,
      });
      done(null, state);
    },
    verify(req, state, meta, done) {
      prune();
      const record = typeof state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(state) ? records.get(state) : null;
      if (
        !record ||
        !req.session ||
        record.browser !== req.session[sessionKey] ||
        record.provider !== providerBinding(meta)
      ) {
        return done(null, false, { message: 'Sign-in expired. Please try again.' });
      }
      // Synchronous delete precedes token exchange, so replay and concurrent
      // callbacks cannot mint multiple sessions from one authorization.
      records.delete(state);
      done(null, record.verifier);
    },
  };
}

module.exports = { createGoogleOAuthStateStore };
