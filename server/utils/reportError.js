const { Sentry } = require('../sentry');

// Error objects from third-party SDKs sometimes carry request metadata along
// with their message. Keep the complete error for Sentry, but only write a
// redacted, bounded summary to Render logs so tokens, cookies and credentials
// cannot end up in a retained log stream.
function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|otp|code))\s*[:=]\s*["']?[^\s,"'}]+/gi,
      '$1=[redacted]'
    )
    .slice(0, 1200);
}

function safeErrorSummary(err) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redact(err.message),
    };
  }
  return redact(err);
}

// Every route in this app catches its own errors and responds directly
// (res.status(500)...) instead of calling next(err) — which means Express's
// Sentry error handler (server/sentry.js's attachErrorHandler) never sees
// them; only a literal uncaught process crash reached Sentry before this
// existed. Call this from a catch block instead of a bare console.error so
// real application errors actually show up in monitoring, not only in raw
// server logs nobody is tailing.
function reportError(err, context) {
  console.error(context || '', safeErrorSummary(err));
  try {
    Sentry.captureException(err);
  } catch (_) {
    /* error reporting itself must never crash the request it's reporting from */
  }
}

module.exports = { reportError, redact, safeErrorSummary };
