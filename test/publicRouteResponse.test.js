require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { servePublicApp } = require('../server/publicMetadata');

test('known public routes remain 200; unknown paths are genuine non-indexable 404s without redirects', async (t) => {
  const app = express();
  app.get('/{*splat}', (req, res) => servePublicApp(req, res, path.join(__dirname, '..')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/scanner', '/policy', '/accessibility']) {
    const response = await fetch(origin + route, { redirect: 'manual' });
    assert.equal(response.status, 200);
  }
  for (const route of ['/not-a-page', '/not-a-page/', '/%3Cscript%3E']) {
    const response = await fetch(origin + route, { redirect: 'manual' });
    const html = await response.text();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(html, /Page not found/);
    assert.doesNotMatch(html, /rel="canonical"/);
    assert.doesNotMatch(html, /%3Cscript%3E/);
  }
});

test('trial expiry cannot automatically open a paywall when a page loads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  assert.doesNotMatch(source, /trialEndedAutoShownRef|queueMicrotask\(\(\) => setShowTrialEndedModal\(true\)\)/);
  assert.match(source, /function onTrialEnded\(\)\s*\{\s*setShowTrialEndedModal\(true\)/);
  assert.match(source, /path="\*" element=\{<NotFoundPage \/>\}/);
});
