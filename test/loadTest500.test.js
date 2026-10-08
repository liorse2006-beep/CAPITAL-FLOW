const assert = require('node:assert/strict');
const { test } = require('node:test');

test('load-test safety blocks production aliases and target-changing paths', async () => {
  const { runLoadTest } = await import('../scripts/load-test-500.mjs');
  const original = process.env.LOAD_TEST_CONFIRM;
  process.env.LOAD_TEST_CONFIRM = 'staging';
  try {
    for (const targetUrl of [
      'https://capitalflow.vip',
      'https://status.capitalflow.vip',
      'https://capital-flow-3v59.onrender.com',
    ]) {
      await assert.rejects(runLoadTest({ targetUrl }), /Production load testing/);
    }
    for (const path of ['https://capitalflow.vip/health', '//capitalflow.vip/health', '/\\capitalflow.vip/health']) {
      await assert.rejects(runLoadTest({ targetUrl: 'http://127.0.0.1:3001', paths: [path] }), /approved origin/);
    }
    await assert.rejects(runLoadTest({ targetUrl: 'http://127.0.0.1:3001', users: 501 }), /1 to 500/);
  } finally {
    if (original === undefined) delete process.env.LOAD_TEST_CONFIRM;
    else process.env.LOAD_TEST_CONFIRM = original;
  }
});

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
