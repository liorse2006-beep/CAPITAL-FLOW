require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const statusRouter = require('../server/routes/status');
const { RENDER_PROXY_HOPS } = require('../server/proxyTrust');

test('status limiters do not emit forwarded-header warnings when proxy trust is intentionally disabled', async () => {
  const app = express();
  app.set('trust proxy', false);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/status/api/admin/overview`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    assert.equal(response.status, 401);
    assert.equal(
      errors.some((entry) => entry.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')),
      false,
      'status limiter must not log the forwarded-header diagnostic'
    );
  } finally {
    console.error = originalError;
    server.close();
  }
});

test('status limiters accept the Render proxy chain without emitting a trust-proxy warning', async () => {
  const app = express();
  app.set('trust proxy', RENDER_PROXY_HOPS);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/status/api/admin/overview`, {
      headers: { 'X-Forwarded-For': '203.0.113.10, 198.51.100.20' },
    });
    assert.equal(response.status, 401);
    assert.equal(
      errors.some((entry) => entry.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')),
      false,
      'Render proxy configuration must not log the forwarded-header diagnostic'
    );
  } finally {
    console.error = originalError;
    server.close();
  }
});

test('public status APIs reject the request after the dedicated per-IP budget', async () => {
  const app = express();
  app.set('trust proxy', RENDER_PROXY_HOPS);
  app.use('/', statusRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const headers = { 'X-Forwarded-For': '203.0.113.250, 198.51.100.20' };
    let response;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await fetch(`http://127.0.0.1:${port}/status/api/summary`, { headers });
      if (attempt < 60) assert.notEqual(response.status, 429);
    }
    assert.equal(response.status, 429);
  } finally {
    server.close();
  }
});
