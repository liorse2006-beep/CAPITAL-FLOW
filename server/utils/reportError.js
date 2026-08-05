const { Sentry } = require('../sentry');

// Every route in this app catches its own errors and responds directly
// (res.status(500)...) instead of calling next(err) — which means Express's
// Sentry error handler (server/sentry.js's attachErrorHandler) never sees
// them; only a literal uncaught process crash reached Sentry before this
// existed. Call this from a catch block instead of a bare console.error so
// real application errors actually show up in monitoring, not only in raw
// server logs nobody is tailing.
function reportError(err, context) {
  console.error(context || '', err);
  try {
    Sentry.captureException(err);
  } catch (_) {
    /* error reporting itself must never crash the request it's reporting from */
  }
}

module.exports = { reportError };
