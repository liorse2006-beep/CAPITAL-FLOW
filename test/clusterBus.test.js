// clusterBus is what makes SSE broadcast (routes/stream.js), the SSE ticket
// store (middleware/authMiddleware.js), and the singleton background
// scheduler (index.js's isSingletonWorker()) safe to run under more than
// one worker (server.js, CLUSTER_WORKERS > 1) instead of silently only
// reaching whichever one process happened to handle a given request.
//
// This process is never itself a cluster worker while running under the
// test runner (cluster.isWorker is false here), so these tests cover the
// default/non-cluster path directly — which must behave exactly like plain
// same-process pub/sub, since that's what every existing deployment, local
// dev run, and this whole test suite actually is. The cross-worker relay
// path (server.js's primary forwarding one worker's publish to its
// siblings) is covered by the separate cluster.integration.test.js, which
// spawns the real multi-worker process tree end to end.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const cluster = require('cluster');
const clusterBus = require('../server/services/clusterBus');

test('publish delivers to local subscribers in the same process', () => {
  const received = [];
  const unsubscribe = clusterBus.subscribe('test-channel', (payload) => received.push(payload));
  clusterBus.publish('test-channel', { hello: 'world' });
  assert.deepStrictEqual(received, [{ hello: 'world' }]);
  unsubscribe();
});

test('subscribers on a different channel do not receive an unrelated publish', () => {
  const received = [];
  const unsubscribe = clusterBus.subscribe('channel-a', (payload) => received.push(payload));
  clusterBus.publish('channel-b', { nope: true });
  assert.deepStrictEqual(received, []);
  unsubscribe();
});

test('unsubscribe actually stops delivery', () => {
  const received = [];
  const unsubscribe = clusterBus.subscribe('channel-c', (payload) => received.push(payload));
  clusterBus.publish('channel-c', 1);
  unsubscribe();
  clusterBus.publish('channel-c', 2);
  assert.deepStrictEqual(received, [1]);
});

test('isSingletonWorker is true outside a cluster worker (every real deployment today, local dev, and this test run)', () => {
  assert.strictEqual(cluster.isWorker, false, 'sanity check: the test runner itself is not a cluster worker');
  assert.strictEqual(clusterBus.isSingletonWorker(), true);
});

test('publish does not attempt process.send outside a cluster worker (would throw/no-op silently otherwise)', () => {
  // process.send is undefined for a normal (non-forked) process — if
  // publish() unconditionally called it instead of guarding on
  // cluster.isWorker, this would throw "process.send is not a function".
  assert.strictEqual(typeof process.send, 'undefined');
  assert.doesNotThrow(() => clusterBus.publish('any-channel', { x: 1 }));
});
