// Error monitoring — fully opt-in, mirrors server/sentry.js. With no
// VITE_SENTRY_DSN set at build time, every export here is a no-op, so local
// dev and any environment without a DSN behave exactly as before. Set
// VITE_SENTRY_DSN (same value as the server's SENTRY_DSN, since both point
// at the same Sentry project) to start reporting browser-side crashes.
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN || '';
const enabled = !!DSN;

if (enabled) {
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE || 'production',
    tracesSampleRate: 0.1,
  });
}

export { Sentry, enabled };
