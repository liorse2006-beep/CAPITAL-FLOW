const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
</head><body><div id="root"></div><section id="seo-route-content" class="seo-discovery-content" aria-label="Capital Flow product information"></section></body></html>`;

test('public route metadata is available for every indexable app route', () => {
  for (const route of ['/', '/scanner', '/ma', '/flow', '/fundamentals', '/watchlist', '/policy', '/accessibility']) {
    assert.ok(getPublicMetadata(route), `expected metadata for ${route}`);
  }
  assert.equal(getPublicMetadata('/fundamentals/').title, getPublicMetadata('/fundamentals').title);
  assert.equal(getPublicMetadata('/private-area'), null);
});

test('Docker runtime image includes the route content required by server-side rendering', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY --from=builder \/app\/src\/data\/seoContent\.json \.\/src\/data\/seoContent\.json/);
});

test('server-rendered route metadata replaces the SPA defaults without trusting the URL as content', () => {
  const rendered = renderPublicMetadata(SHELL, '/fundamentals');
  assert.match(rendered, /<title>Fundamental Stock Analysis \| Capital Flow<\/title>/);
  assert.match(rendered, /name="description" content="Review available P\/E, forward P\/E, PEG/);
  assert.match(rendered, /property="og:url" content="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /rel="canonical" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(
    rendered,
    /<section id="seo-route-content"[^>]*><h2 id="stock-fundamentals-title">Stock Fundamentals Research<\/h2>/
  );
  assert.match(rendered, /Review available company and valuation metrics in Capital Flow/);
  assert.equal(renderPublicMetadata(SHELL, '/not-a-route'), SHELL);
});

test('the homepage has Hebrew crawlable content and links to the main research tools', () => {
  const rendered = renderPublicMetadata(SHELL, '/');

  assert.match(rendered, /סורק מניות וכלי מחקר לשוק ההון/);
  assert.match(rendered, /סורק הנפח משווה בין נפח המסחר המדווח/);
  assert.match(rendered, /href="\/scanner">סורק נפח מסחר חריג<\/a>/);
  assert.match(rendered, /href="\/fundamentals">נתונים פיננסיים<\/a>/);
  assert.match(rendered, /אינו ייעוץ השקעות/);
});

test('route-specific crawl copy is present in the initial HTML and links only to internal paths', () => {
  const rendered = renderPublicMetadata(SHELL, '/scanner');

  assert.match(rendered, /<h2 id="volume-scanner-title">Unusual Volume Stock Scanner<\/h2>/);
  assert.match(rendered, /Market data may be delayed, estimated or incomplete/);
  assert.match(rendered, /href="\/ma">Moving Average Scanner<\/a>/);
  assert.doesNotMatch(rendered, /Data provenance|Yahoo Finance|Finnhub|Massive/);
});

test('scanner metadata describes available screening tools without claiming live or complete coverage', () => {
  const scanner = getPublicMetadata('/scanner');
  const movingAverage = getPublicMetadata('/ma');
  const sectorFlow = getPublicMetadata('/flow');

  assert.match(scanner.title, /Unusual Volume Stock Scanner/);
  assert.match(scanner.description, /may be delayed or incomplete/i);
  assert.doesNotMatch(scanner.description, /real[- ]time|entire market|breakout potential/i);
  assert.match(movingAverage.title, /Moving Average Stock Scanner/);
  assert.match(movingAverage.description, /9, 20, 50 and 150/);
  assert.match(sectorFlow.title, /Stock Sector Performance/);
  assert.match(sectorFlow.description, /may be delayed or incomplete/i);
});
