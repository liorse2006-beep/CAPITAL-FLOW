// server/utils/circuitBreaker.js — protects outbound provider calls
// (Yahoo, Finnhub) from being hammered with retries during an outage.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const { createCircuitBreaker } = require('../server/utils/circuitBreaker');

test('stays closed and returns the wrapped result while calls succeed', async () => {
  const breaker = createCircuitBreaker('test', { failureThreshold: 3, cooldownMs: 1000 });
  const result = await breaker.execute(async () => 'ok');
  assert.strictEqual(result, 'ok');
  assert.strictEqual(breaker.getState(), 'closed');
});

test('opens after reaching the failure threshold and rejects without calling the function', async () => {
  const breaker = createCircuitBreaker('test', { failureThreshold: 2, cooldownMs: 1000 });
  const failing = async () => {
    throw new Error('boom');
  };

  await assert.rejects(() => breaker.execute(failing));
  assert.strictEqual(breaker.getState(), 'closed'); // 1st failure, still under threshold
  await assert.rejects(() => breaker.execute(failing));
  assert.strictEqual(breaker.getState(), 'open'); // 2nd failure hits the threshold

  let called = false;
  await assert.rejects(
    () =>
      breaker.execute(async () => {
        called = true;
        return 'should not run';
      }),
    (err) => err.circuitOpen === true
  );
  assert.strictEqual(called, false);
});

test('moves to half-open after the cooldown and fully closes on a successful probe', async () => {
  const breaker = createCircuitBreaker('test', { failureThreshold: 1, cooldownMs: 20 });
  await assert.rejects(() =>
    breaker.execute(async () => {
      throw new Error('boom');
    })
  );
  assert.strictEqual(breaker.getState(), 'open');

  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(breaker.getState(), 'half_open');

  const result = await breaker.execute(async () => 'recovered');
  assert.strictEqual(result, 'recovered');
  assert.strictEqual(breaker.getState(), 'closed');
});

test('a failed probe during half-open re-opens immediately', async () => {
  const breaker = createCircuitBreaker('test', { failureThreshold: 1, cooldownMs: 20 });
  await assert.rejects(() =>
    breaker.execute(async () => {
      throw new Error('boom');
    })
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(breaker.getState(), 'half_open');

  await assert.rejects(() =>
    breaker.execute(async () => {
      throw new Error('still down');
    })
  );
  assert.strictEqual(breaker.getState(), 'open');
});

test('a success resets the consecutive-failure count', async () => {
  const breaker = createCircuitBreaker('test', { failureThreshold: 2, cooldownMs: 1000 });
  await assert.rejects(() =>
    breaker.execute(async () => {
      throw new Error('boom');
    })
  );
  await breaker.execute(async () => 'ok');
  await assert.rejects(() =>
    breaker.execute(async () => {
      throw new Error('boom');
    })
  );
  // Two failures total, but not consecutive — should still be closed.
  assert.strictEqual(breaker.getState(), 'closed');
});
