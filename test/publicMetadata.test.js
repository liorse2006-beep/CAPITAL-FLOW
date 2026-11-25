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
  assert.match(rendered, /<title>נתונים פיננסיים למניות \| Capital Flow<\/title>/);
  assert.match(rendered, /name="description" content="מכפיל רווח/);
  assert.match(rendered, /property="og:url" content="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /rel="canonical" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.doesNotMatch(rendered, /seo-route-content/);
  assert.match(rendered, /hreflang="he" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.match(rendered, /hreflang="x-default" href="https:\/\/capitalflow\.vip\/fundamentals"/);
  assert.doesNotMatch(rendered, /hreflang="en"/);
  assert.match(rendered, /<html[^>]*lang="he"[^>]*dir="ltr"/);
  assert.equal(renderPublicMetadata(SHELL, '/not-a-route'), SHELL);
});

test('the homepage has Hebrew crawlable content and links to the main research tools', () => {
  const rendered = renderPublicMetadata(SHELL, '/');

  assert.match(rendered, /סורק מניות וכלי מחקר לשוק ההון/);
  assert.match(rendered, /משווה את הנפח של כל מניה לממוצע שלה/);
  assert.match(rendered, /href="\/scanner">סורק נפח מסחר חריג<\/a>/);
  assert.match(rendered, /href="\/fundamentals">נתונים פיננסיים<\/a>/);
  assert.match(rendered, /אינו המלצה לפעולה/);
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

  assert.match(scanner.title, /סורק נפח מסחר חריג/);
  assert.match(scanner.description, /עשויים להיות מעוכבים/);
  assert.doesNotMatch(scanner.description, /זמן אמת|כל השוק/);
  assert.match(movingAverage.title, /סורק ממוצעים נעים/);
  assert.match(movingAverage.description, /9, 20, 50 או 150/);
  assert.match(sectorFlow.title, /פעילות בסקטורים/);
  assert.match(sectorFlow.description, /עשויים להיות מעוכבים/);
});

test('the home page ships its full Hebrew copy, FAQ and links in the initial HTML', () => {
  const { renderPublicMetadata } = require('../server/publicMetadata');
  const shell =
    '<html lang="he"><head><title>x</title></head><body><div id="root"></div><section id="seo-route-content" class="seo-discovery-content"></section></body></html>';
  const html = renderPublicMetadata(shell, '/');
  assert.match(html, /<h1>Capital Flow — סורק מניות/);
  assert.match(html, /האם אפשר להתחיל בחינם\?/);
  for (const href of ['/scanner', '/learn', '/stocks', '/etfs']) assert.ok(html.includes(`href="${href}"`), href);
  assert.ok(html.includes('התוכן לצורכי לימוד בלבד ואינו המלצה לפעולה.'));
});

test('the static handler never answers "/" before the metadata renderer', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '../server/index.js'), 'utf8');
  assert.match(source, /express\.static\(serveDir, \{[\s\S]{0,200}index: false/);
});
