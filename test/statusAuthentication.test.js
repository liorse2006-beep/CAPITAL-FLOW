const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/testEnv');
const { checkAuthentication } = require('../server/services/statusAuthentication');

const base = 'https://application.example.test';
function challenge(status = 200, body, cookie = true) {
  return new Response(
    JSON.stringify(
      body || {
        parameters: { algorithm: 'PBKDF2/SHA-256', data: { purpose: 'login' } },
        signature: 'synthetic-challenge',
      }
    ),
    {
      status,
      headers: cookie ? { 'set-cookie': 'vs_login_verification=' + 'a'.repeat(64) + '; HttpOnly; Path=/api/auth' } : {},
    }
  );
}
function account(status = 401, body = { error: 'Unauthorized' }) {
  return new Response(JSON.stringify(body), { status });
}

test('production challenge and anonymous rejection are healthy without posting credentials', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['x-status-check-token'], undefined);
    return String(url).endsWith('/login-challenge') ? challenge() : account();
  });
  const result = await checkAuthentication(base, 1000);
  assert.equal(result.success, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    [base + '/api/auth/login-challenge', base + '/api/auth/me']
  );
  assert.equal(JSON.stringify(result).includes('synthetic-challenge'), false);
  assert.equal(JSON.stringify(result).includes('vs_login_verification'), false);
});

test('HTTP errors, redirects, HTML and malformed or missing login verification are not treated as healthy', async (t) => {
  const responses = [
    challenge(400),
    challenge(401),
    challenge(429),
    challenge(503),
    new Response('', { status: 302, headers: { location: 'https://other.example.test' } }),
    new Response('<html>Login</html>'),
    challenge(200, {}),
    challenge(200, {
      parameters: { algorithm: 'PBKDF2/SHA-256', data: { purpose: 'signup' } },
      signature: 'wrong-purpose',
    }),
    challenge(200, undefined, false),
  ];
  let current, calls;
  t.mock.method(global, 'fetch', async () => {
    calls += 1;
    return current;
  });
  for (const response of responses) {
    current = response;
    calls = 0;
    const result = await checkAuthentication(base, 1000);
    assert.equal(result.success, false);
    assert.equal(result.endpoint, '/api/auth/login-challenge');
    assert.equal(calls, 1);
  }
});

test('account errors, redirects, malformed rejection and accidental anonymous access remain failures', async (t) => {
  let current;
  t.mock.method(global, 'fetch', async (url) => (String(url).endsWith('/login-challenge') ? challenge() : current));
  for (const response of [
    account(200, { user: { id: 1 } }),
    account(401, { error: 'wrong' }),
    account(401, { error: 'Unauthorized', token: 'synthetic' }),
    account(503),
    account(302),
  ]) {
    current = response;
    const result = await checkAuthentication(base, 1000);
    assert.equal(result.success, false);
    assert.equal(result.endpoint, '/api/auth/me');
  }
});

test('network failure and timeout propagate to the normal monitor outage handling', async (t) => {
  t.mock.method(global, 'fetch', async () => {
    throw new DOMException('Synthetic timeout', 'TimeoutError');
  });
  await assert.rejects(checkAuthentication(base, 1000), { name: 'TimeoutError' });
});

test('the monitor works against real production-mode routes without creating users or sessions', async () => {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const db = require('../server/db');
  const router = require('../server/routes/auth');
  await db.ready;
  const counts = () =>
    db.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM user_sessions) AS sessions').get();
  const before = await counts();
  const previousEnvironment = process.env.NODE_ENV;
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/auth', router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    process.env.NODE_ENV = 'production';
    const result = await checkAuthentication(`http://127.0.0.1:${server.address().port}`, 5000);
    assert.equal(result.success, true, result.errorMessage);
    assert.deepEqual(await counts(), before);
  } finally {
    process.env.NODE_ENV = previousEnvironment;
    await new Promise((resolve) => server.close(resolve));
  }
});
