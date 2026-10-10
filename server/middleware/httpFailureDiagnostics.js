const { performance } = require('node:perf_hooks');

// Response counts alone cannot distinguish an application 502 from an edge
// failure. Log only 5xx finishes, with developer-defined route patterns (never
// the request URL, query, parameters, headers, payload or user identity).
function createHttpFailureDiagnostics({ logger = console, now = () => performance.now() } = {}) {
  const recent = new Map();
  const windowMs = 60_000;
  const maxKeys = 128;

  return function httpFailureDiagnostics(req, res, next) {
    const started = now();
    res.once('finish', () => {
      const statusCode = res.statusCode;
      if (!Number.isInteger(statusCode) || statusCode < 500 || statusCode > 599) return;
      const pattern = req.route?.path;
      const route =
        typeof pattern === 'string' && /^\/[A-Za-z0-9_/:*.-]{0,119}$/.test(pattern) ? pattern : '<unmatched>';
      const key = `${statusCode}:${route}`;
      const finished = now();
      const previous = recent.get(key);
      if (previous && finished - previous.at < windowMs) {
        previous.suppressed += 1;
        return;
      }
      if (!previous && recent.size >= maxKeys) recent.delete(recent.keys().next().value);
      recent.set(key, { at: finished, suppressed: 0 });
      try {
        logger.warn('[http] request failed', {
          route,
          statusCode,
          durationMs: Math.round(Math.max(0, finished - started)),
          suppressedSincePrevious: previous?.suppressed || 0,
        });
      } catch {
        // Diagnostics must never turn an already-completed response into an
        // uncaught process exception or change authentication/error behavior.
      }
    });
    next();
  };
}

module.exports = { createHttpFailureDiagnostics };
