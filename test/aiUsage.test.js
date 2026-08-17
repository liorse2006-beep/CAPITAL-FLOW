require('./helpers/testEnv');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const { reserveAiCall } = require('../server/services/aiUsage');

beforeEach(async () => {
  await db.ready;
  await db.prepare('DELETE FROM ai_usage').run();
});

test('durably enforces a shared provider budget across users', async () => {
  assert.equal(await reserveAiCall('test-provider', 101, { globalLimit: 2, userLimit: 10 }), true);
  assert.equal(await reserveAiCall('test-provider', 202, { globalLimit: 2, userLimit: 10 }), true);
  assert.equal(await reserveAiCall('test-provider', 303, { globalLimit: 2, userLimit: 10 }), false);
});

test('enforces a per-user budget without blocking another user below the global cap', async () => {
  assert.equal(await reserveAiCall('test-user-cap', 101, { globalLimit: 10, userLimit: 1 }), true);
  assert.equal(await reserveAiCall('test-user-cap', 101, { globalLimit: 10, userLimit: 1 }), false);
  assert.equal(await reserveAiCall('test-user-cap', 202, { globalLimit: 10, userLimit: 1 }), true);
});
