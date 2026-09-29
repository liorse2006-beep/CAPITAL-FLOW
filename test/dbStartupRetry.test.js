const assert = require('node:assert/strict');
const test = require('node:test');
const { isRetryableDatabaseError, retryDelayMs, retryUntilReady } = require('../server/db/startupRetry');

test('database quota and network failures are classified as retryable', () => {
  const quotaError = new Error('Your account or project has exceeded the quota.');
  assert.equal(isRetryableDatabaseError(quotaError), true);
  assert.equal(retryDelayMs(1, quotaError), 15 * 60 * 1000);
  assert.equal(retryDelayMs(2, quotaError), 30 * 60 * 1000);
  assert.equal(retryDelayMs(99, quotaError), 60 * 60 * 1000);
  assert.equal(isRetryableDatabaseError({ code: '08006', message: 'connection failure' }), true);
  assert.equal(isRetryableDatabaseError({ code: 'ETIMEDOUT' }), true);
});

test('schema/programming errors are not retried as provider outages', () => {
  assert.equal(isRetryableDatabaseError(new Error('syntax error at or near SELECT')), false);
});

test('transient database initialization recovers with capped exponential backoff', async () => {
  let calls = 0;
  const delays = [];
  const retryEvents = [];
  const result = await retryUntilReady(
    async () => {
      calls += 1;
      if (calls < 4) throw new Error('database temporarily unavailable');
      return 'ready';
    },
    {
      wait: async (ms) => delays.push(ms),
      onRetry: (_error, details) => retryEvents.push(details),
    }
  );

  assert.equal(result, 'ready');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [5000, 10000, 20000]);
  assert.deepEqual(
    retryEvents.map((event) => event.attempt),
    [1, 2, 3]
  );
  assert.equal(retryDelayMs(99), 5 * 60 * 1000);
});
