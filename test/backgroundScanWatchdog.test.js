// Regression for the background scanner's hang-forever risk: before this,
// runBackgroundScan() had no ceiling at all — a stalled scanTickers() call
// left backgroundCache.running stuck true permanently, and the scheduler's
// `if (backgroundCache.running) return` check then silently skipped every
// future tick for the rest of the process's uptime. withHardTimeout is the
// mechanism that now bounds it; runBackgroundScan wires it up with a
// finally-block reset of backgroundCache.running so the flag can never get
// stuck even if the timeout itself fires.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const scanner = require('../server/services/scanner');
const { backgroundCache, runBackgroundScan, withHardTimeout } = require('../server/services/backgroundScan');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('withHardTimeout resolves normally when the wrapped promise finishes in time', async () => {
  const result = await withHardTimeout(Promise.resolve('done'), 1000, 'test');
  assert.strictEqual(result, 'done');
});

test('withHardTimeout rejects a promise that never settles, instead of hanging forever', async () => {
  const neverResolves = new Promise(() => {}); // simulates a stalled network call
  await assert.rejects(withHardTimeout(neverResolves, 50, 'stalled scan'), /stalled scan exceeded 50ms hard timeout/);
});

test('withHardTimeout propagates the original rejection when the promise fails before the timeout', async () => {
  const fails = Promise.reject(new Error('upstream error'));
  await assert.rejects(withHardTimeout(fails, 1000, 'test'), /upstream error/);
});

test('runBackgroundScan does not overlap a timed-out scan that is still settling', async () => {
  const originalScanTickers = scanner.scanTickers;
  const gate = deferred();
  let calls = 0;
  scanner.scanTickers = () => {
    calls += 1;
    return gate.promise;
  };

  backgroundCache.running = false;
  backgroundCache.inFlight = null;
  backgroundCache.results = null;
  backgroundCache.scanTime = null;

  try {
    await runBackgroundScan({ maxDurationMs: 20 });
    assert.strictEqual(calls, 1);
    assert.strictEqual(backgroundCache.running, false);
    assert.ok(backgroundCache.inFlight);

    await runBackgroundScan({ maxDurationMs: 20 });
    assert.strictEqual(calls, 1);

    gate.resolve({ results: [], dataStatus: 'complete', dataAsOf: new Date().toISOString() });
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(backgroundCache.inFlight, null);
  } finally {
    scanner.scanTickers = originalScanTickers;
    backgroundCache.running = false;
    backgroundCache.inFlight = null;
    backgroundCache.results = null;
    backgroundCache.scanTime = null;
  }
});
