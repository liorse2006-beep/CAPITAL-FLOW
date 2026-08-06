// Generic circuit breaker for calls to a third-party provider (Yahoo,
// Finnhub, ...). A stalled/rate-limited provider left alone means every
// concurrent scan keeps retrying it with backoff — the app-level timeout
// (fetchWithTimeout) bounds a single call, but does nothing to stop
// hundreds of calls in a row from each paying that same cost during an
// outage. After `failureThreshold` consecutive failures the breaker
// "opens" and rejects immediately (no network call at all) for
// `cooldownMs`, then allows exactly one probe call (HALF_OPEN) to test
// recovery before resuming normal traffic.
const CLOSED = 'closed';
const OPEN = 'open';
const HALF_OPEN = 'half_open';

function createCircuitBreaker(name, options) {
  const opts = options || {};
  const failureThreshold = opts.failureThreshold || 5;
  const cooldownMs = opts.cooldownMs || 30000;

  let state = CLOSED;
  let consecutiveFailures = 0;
  let openedAt = 0;

  // Lazily transitions OPEN -> HALF_OPEN once the cooldown has elapsed —
  // there is no timer running in the background, just a check on read.
  function currentState() {
    if (state === OPEN && Date.now() - openedAt >= cooldownMs) {
      state = HALF_OPEN;
    }
    return state;
  }

  function onSuccess() {
    consecutiveFailures = 0;
    state = CLOSED;
  }

  function onFailure() {
    consecutiveFailures += 1;
    // A failure while probing (HALF_OPEN) re-opens immediately — one
    // failed probe is enough evidence the provider isn't back yet.
    if (state === HALF_OPEN || consecutiveFailures >= failureThreshold) {
      state = OPEN;
      openedAt = Date.now();
      console.warn(
        `[circuitBreaker:${name}] opened after ${consecutiveFailures} consecutive failures — rejecting calls for ${cooldownMs}ms`
      );
    }
  }

  // Runs `fn` if the breaker currently allows it. When short-circuited,
  // throws an Error with `circuitOpen: true` set — callers that already
  // have a stale-data/fallback path for ordinary failures (quoteCache,
  // etc.) can treat this exactly like any other failure and fall back to
  // it, without the wasted network round-trip.
  async function execute(fn) {
    if (currentState() === OPEN) {
      const err = new Error(`[circuitBreaker:${name}] circuit open — call rejected without attempting`);
      err.circuitOpen = true;
      throw err;
    }
    try {
      const result = await fn();
      onSuccess();
      return result;
    } catch (err) {
      onFailure();
      throw err;
    }
  }

  return {
    execute,
    getState: currentState,
  };
}

module.exports = { createCircuitBreaker };
