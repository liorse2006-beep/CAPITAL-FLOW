const RETRYABLE_CODES = new Set([
  '40001', // serialization failure
  '40P01', // deadlock detected
  '53300', // too many connections
  '53400', // configuration limit exceeded
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '57P03', // cannot connect now
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

const RETRYABLE_MESSAGE =
  /quota|temporar(?:y|ily)|unavailable|too many connections|too many requests|rate.?limit|timed?\s*out|timeout|connection (?:reset|refused|terminated|closed)|server closed the connection|network|socket|econn|eai_again|resource limit|\b429\b|\b503\b/i;

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

function isRetryableDatabaseError(error) {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const code = String(current.code || '').toUpperCase();
    if (RETRYABLE_CODES.has(code) || code.startsWith('08')) return true;
    if (RETRYABLE_MESSAGE.test(String(current.message || current))) return true;
    current = current.cause;
  }
  return false;
}

function retryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(MAX_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS * 2 ** Math.min(safeAttempt - 1, 16));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryUntilReady(operation, { wait = sleep, onRetry = () => {} } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableDatabaseError(error)) throw error;
      attempt += 1;
      const delayMs = retryDelayMs(attempt);
      onRetry(error, { attempt, delayMs });
      await wait(delayMs);
    }
  }
}

module.exports = { isRetryableDatabaseError, retryDelayMs, retryUntilReady };
