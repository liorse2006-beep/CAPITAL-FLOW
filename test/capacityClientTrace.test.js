const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { isolatedMarker, installClientRequestTrace } = require('../scripts/capacity-client-trace.cjs');
test('client marker accepts only synthetic IDs without retaining raw headers', () => {
  assert.equal(isolatedMarker(['Authorization', 'Bearer secret', 'X-Isolated-Request-Id', '500.1']), '500.1');
  assert.equal(isolatedMarker('Authorization: Bearer secret\r\nx-isolated-request-id: 200.1\r\n'), '200.1');
  for (const value of [
    'Bearer secret',
    null,
    ['X-Isolated-Request-Id', 'user@test.local'],
    ['X-Isolated-Request-Id', '500.1', 'x-isolated-request-id', '500.2'],
  ])
    assert.equal(isolatedMarker(value), null);
});
test('real offline HTTP request records create/write/response timestamps and resets safely', async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3001, '127.0.0.1', resolve);
  });
  const trace = installClientRequestTrace();
  try {
    const response = await fetch('http://127.0.0.1:3001/api/watchlist', {
      headers: { 'X-Isolated-Request-Id': '500.1', Authorization: 'Bearer synthetic-secret-must-not-be-retained' },
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    });
    assert.deepEqual(await response.json(), { ok: true });
    const recorded = trace.get('500.1');
    for (const field of ['createdAt', 'sentAt', 'responseHeadersAt'])
      assert.ok(Number.isSafeInteger(recorded[field]) && recorded[field] > 0);
    assert.equal(recorded.erroredAt, null);
    assert.doesNotMatch(JSON.stringify(recorded), /Bearer|secret|headers|watchlist/);
    assert.equal(trace.get('500.6001'), null);
    trace.reset();
    assert.equal(trace.get('500.1'), null);
  } finally {
    trace.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
