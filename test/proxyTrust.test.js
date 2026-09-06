const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { resolveTrustedProxy, RENDER_PROXY_HOPS } = require('../server/proxyTrust');

test('Render uses the documented two-hop proxy chain, never permissive trust', () => {
  const trust = resolveTrustedProxy({ isRender: true });
  assert.strictEqual(trust, RENDER_PROXY_HOPS);
  assert.notStrictEqual(trust, true);
});

test('unconfigured non-Render deployments trust no forwarded proxy', () => {
  assert.strictEqual(resolveTrustedProxy({ isRender: false }), false);
});

test('explicit proxy CIDRs override the Render fallback', () => {
  const trust = resolveTrustedProxy({ cidrs: ['127.0.0.1'], isRender: true });
  assert.strictEqual(typeof trust, 'function');
  assert.strictEqual(trust('127.0.0.1'), true);
  assert.strictEqual(trust('203.0.113.10'), false);
});

test('the Render hop count resolves the client address through two proxies', async () => {
  const app = express();
  app.set('trust proxy', resolveTrustedProxy({ isRender: true }));
  app.get('/probe', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/probe`, {
      headers: { 'X-Forwarded-For': '203.0.113.10, 198.51.100.20' },
    });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { ip: '203.0.113.10' });
  } finally {
    server.close();
  }
});
