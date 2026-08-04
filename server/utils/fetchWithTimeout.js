// A single hung outbound connection (Yahoo, Finnhub, Gemini, Whop, a news
// provider) must never be able to freeze a request — or worse, the
// background scanner — forever. Every raw `fetch()` call anywhere on the
// server should go through this instead of bare `fetch()`, which relies on
// platform defaults and has no timeout at all.
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * fetch() with a hard timeout. Combines a caller-supplied AbortSignal (if
 * any) with the timeout signal, so a caller that already needs its own
 * cancellation (e.g. resolveFinalUrl's own signal) still gets timeout
 * protection layered on top rather than losing its own signal.
 */
function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal });
}

module.exports = { fetchWithTimeout, DEFAULT_TIMEOUT_MS };
