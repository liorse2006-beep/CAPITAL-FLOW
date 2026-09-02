const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getPublicMetadata, renderPublicMetadata } = require('../server/publicMetadata');

const SHELL = `<!doctype html>
<html><head>
<title>Home</title>
<meta name="description" content="home">
<meta property="og:title" content="home">
<meta property="og:description" content="home">
<meta property="og:url" content="https://capitalflow.vip/">
<meta name="twitter:title" content="home">
<meta name="twitter:description" content="home">
<link rel="canonical" href="https://capitalflow.vip/">
</head><body></body></html>`;

test('public route metadata is available for every indexable app route', () => {
  for (const route of ['/', '/scanner', '/ma', '/flow', '/fundamentals', '/watchlist', '/policy', '/accessibility']) {
    assert.ok(getPublicMetadata(route), `expected metadata for ${route}`);
  }
  assert.equal(getPublicMetadata('/fundamentals/').title, getPublicMetadata('/fundamentals').title);
  assert.equal(getPublicMetadata('/private-area'), null);
});

test('server-rendered route metadata replaces the SPA defaults without trusting the URL as content', () => {
  const rendered = renderPublicMetadata(SHELL, '/fundamentals');
  assert.match(rendered, /<title>Fundamental Stock Analysis \| Capital Flow<\/title>/);
  assert.match(rendered, /name="description" content="Review P\/E, forward P\/E, PEG/);
  assert.match(rendered, /property="og:url" content="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /rel="canonical" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.equal(renderPublicMetadata(SHELL, '/not-a-route'), SHELL);
});
