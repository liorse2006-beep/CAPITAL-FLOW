const assert = require('node:assert/strict');
const { test } = require('node:test');

test('500-user load-test harness executes 500 read-only requests and measures them', async () => {
  const { runLoadTest } = await import('../scripts/load-test-500.mjs');
  const result = await runLoadTest({
    targetUrl: 'http://127.0.0.1:3001',
    users: 500,
    paths: ['/health'],
    timeoutMs: 2_000,
    maxErrorRate: 0,
    maxP95Ms: 2_000,
    fetchImpl: async () => new Response('{"status":"ok"}', { status: 200 }),
  });
  assert.equal(result.virtualUsers, 500);
  assert.equal(result.requests, 500);
  assert.equal(result.failures, 0);
  assert.equal(result.errorRate, 0);
  assert.equal(result.statusCounts['200'], 500);
  assert.equal(result.passed, true);
  assert.ok(result.latencyMs.p95 >= 0);
});
