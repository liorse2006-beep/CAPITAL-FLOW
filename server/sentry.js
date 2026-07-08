// Error monitoring — fully opt-in. With no SENTRY_DSN set, every export here
// is a no-op, so local dev and any environment without a DSN behave exactly
// as before. Set SENTRY_DSN in .env to start reporting server-side crashes.
const Sentry = require('@sentry/node');

const DSN = process.env.SENTRY_DSN || '';
const enabled = !!DSN;

if (enabled) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'production',
    integrations: [Sentry.expressIntegration()],
    tracesSampleRate: 0.1, // light tracing; raise once volume/cost is understood
  });
}

/** Attach Sentry's Express error handler — must run after all routes, before any custom error middleware. */
function attachErrorHandler(app) {
  if (enabled) Sentry.setupExpressErrorHandler(app);
}

module.exports = { Sentry, enabled, attachErrorHandler };
