const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHttpFailureDiagnostics } = require('../server/middleware/httpFailureDiagnostics');

function finish(middleware, { statusCode = 502, path = '/landing-logo/:symbol', request = {} } = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  let nextCalls = 0;
  middleware({ ...request, route: { path } }, res, () => nextCalls++);
  assert.equal(nextCalls, 1);
  res.emit('finish');
  res.emit('finish');
  return res;
}

test('5xx diagnostics retain only the route pattern and allowlisted response fields', () => {
  const logs = [];
  let time = 10;
  const middleware = createHttpFailureDiagnostics({
    logger: { warn: (...items) => logs.push(items) },
    now: () => (time += 5),
  });
  const res = finish(middleware, {
    request: {
      originalUrl: '/landing-logo/AAPL?token=private-query',
      params: { symbol: 'PRIVATE-SYMBOL' },
      headers: { authorization: 'private-token' },
      user: { id: 'private-user', email: 'private-email' },
      body: { secret: 'private-payload' },
    },
  });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(logs, [
    [
      '[http] request failed',
      { route: '/landing-logo/:symbol', statusCode: 502, durationMs: 5, suppressedSincePrevious: 0 },
    ],
  ]);
  assert.equal(JSON.stringify(logs).includes('private'), false);
});

test('successful and client-error responses create no diagnostic entries', () => {
  const logs = [];
  const middleware = createHttpFailureDiagnostics({ logger: { warn: (...items) => logs.push(items) } });
  for (const statusCode of [200, 204, 301, 304, 400, 401, 403, 404, 409, 429]) finish(middleware, { statusCode });
  assert.equal(logs.length, 0);
});

test('repeated failures are bounded to one entry per route/status per minute', () => {
  const logs = [];
  let time = 100;
  const middleware = createHttpFailureDiagnostics({
    logger: { warn: (...items) => logs.push(items) },
    now: () => time,
  });
  for (let i = 0; i < 500; i += 1) finish(middleware);
  assert.equal(logs.length, 1);
  time += 60_000;
  finish(middleware);
  assert.equal(logs.length, 2);
  assert.equal(logs[1][1].suppressedSincePrevious, 499);
});

test('an unmatched or unsafe route pattern cannot place request data into logs', () => {
  const logs = [];
  const middleware = createHttpFailureDiagnostics({ logger: { warn: (...items) => logs.push(items) } });
  for (const path of [null, '/private?token=secret', '/private\nforged log', /private-secret/]) {
    finish(middleware, { path, statusCode: 500 });
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].route, '<unmatched>');
  assert.equal(JSON.stringify(logs).includes('secret'), false);
});

test('diagnostic storage is capped even across many developer route patterns', () => {
  const logs = [];
  const middleware = createHttpFailureDiagnostics({
    logger: { warn: (...items) => logs.push(items) },
    now: () => 100,
  });
  for (let i = 0; i < 129; i += 1) finish(middleware, { path: `/synthetic-${i}` });
  assert.equal(logs.length, 129);
  finish(middleware, { path: '/synthetic-0' });
  assert.equal(logs.length, 130, 'oldest key was evicted rather than retaining an unbounded map');
  finish(middleware, { path: '/synthetic-128' });
  assert.equal(logs.length, 130, 'recent keys remain bounded and deduplicated');
});

test('a failing diagnostic sink cannot change the response or throw after finish', () => {
  const middleware = createHttpFailureDiagnostics({
    logger: {
      warn: () => {
        throw new Error('synthetic logging failure');
      },
    },
  });
  const res = finish(middleware, { statusCode: 503, path: '/account/summary' });
  assert.equal(res.statusCode, 503);
});

test('real isolated HTTP failure preserves safe body/status while logging its route', async () => {
  const express = require('express');
  const logs = [];
  const app = express();
  app.use(createHttpFailureDiagnostics({ logger: { warn: (...items) => logs.push(items) } }));
  app.get('/synthetic/:id', (req, res) => res.status(503).json({ error: 'Service temporarily unavailable' }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/synthetic/private-id?secret=private-query`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Service temporarily unavailable' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1].route, '/synthetic/:id');
    assert.equal(JSON.stringify(logs).includes('private'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
