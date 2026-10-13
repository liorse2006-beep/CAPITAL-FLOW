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
<meta property="og:locale" content="he_IL">
<link rel="alternate" hreflang="he" href="https://capitalflow.vip/">
<link rel="alternate" hreflang="x-default" href="https://capitalflow.vip/">
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
  assert.match(rendered, /name="description" content="Review available P\/E/);
  assert.match(rendered, /property="og:url" content="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /rel="canonical" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.doesNotMatch(rendered, /seo-route-content|Stock Fundamentals Research/);
  assert.match(rendered, /hreflang="en" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /hreflang="x-default" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /property="og:locale" content="en_US"/);
  assert.doesNotMatch(rendered, /hreflang="he"/);
  assert.match(rendered, /<html[^>]*lang="en"[^>]*dir="ltr"/);
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

test('application HTML omits the complete explanation section on every route', () => {
  for (const route of ['/scanner', '/ma', '/flow', '/fundamentals', '/watchlist', '/policy', '/accessibility']) {
    const metadata = getPublicMetadata(route);
    const rendered = renderPublicMetadata(SHELL, route);
    assert.doesNotMatch(rendered, /seo-route-content|seo-discovery|Explore other tools/, route);
    assert.match(rendered, /<div id="root"><\/div>/);
    assert.ok(rendered.includes(`<title>${metadata.title.replace(/&/g, '&amp;')}</title>`), route);
    assert.ok(rendered.includes(`href="https://capitalflow.vip${route}"`));
  }
});

test('scanner metadata describes available screening tools without claiming live or complete coverage', () => {
  const scanner = getPublicMetadata('/scanner');
  const movingAverage = getPublicMetadata('/ma');
  const sectorFlow = getPublicMetadata('/flow');

  assert.match(scanner.title, /Unusual Volume Stock Scanner/);
  assert.match(scanner.description, /may be delayed or incomplete/);
  assert.doesNotMatch(scanner.description, /real[- ]time|entire market|breakout potential/i);
  assert.match(movingAverage.title, /Moving Average Stock Scanner/);
  assert.match(movingAverage.description, /9, 20, 50 and 150/);
  assert.match(sectorFlow.title, /Stock Sector Performance/);
  assert.match(sectorFlow.description, /may be delayed or incomplete/);
});
