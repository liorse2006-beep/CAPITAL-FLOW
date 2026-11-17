const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { PAGES, getPage, hasEnglish } = require('../server/learn/content');
const { renderPage, renderHub } = require('../server/learn/render');

const TOP_DISCLAIMER_HE =
  'התוכן לצורכי לימוד בלבד ואינו המלצה לפעולה. הנתונים עשויים להיות מעוכבים או לא מדויקים, ואין התחייבות לנכונותם.';

function startApp() {
  const app = express();
  app.use('/', require('../server/routes/learn'));
  app.use((req, res) => res.status(404).send('not found'));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('every learning page has a unique slug and only links to pages that exist', () => {
  const slugs = PAGES.map((page) => page.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length);
  for (const page of PAGES) {
    assert.match(page.slug, /^[a-z0-9-]+$/);
    assert.ok(page.title.length <= 75, `${page.slug} title too long`);
    assert.ok(page.description.length <= 165, `${page.slug} description too long`);
    for (const related of page.related) assert.ok(getPage(related), `${page.slug} -> ${related}`);
    assert.ok(page.points.length >= 4 && page.points.length <= 5, page.slug + ' points');
    assert.ok(page.right && page.wrong && page.lead, page.slug + ' copy');
    assert.match(page.tool.href, /^\/(scanner|ma|flow|fundamentals|watchlist)$/);
  }
});

test('every learning page has a complete English version', () => {
  for (const page of PAGES) {
    assert.ok(hasEnglish(page.slug), `${page.slug} has no English version`);
    const en = getPage(page.slug, 'en');
    assert.ok(en.title.length <= 80 && en.description.length <= 165, `${page.slug} en meta length`);
    assert.strictEqual(en.points.length, page.points.length, `${page.slug} en point count`);
    assert.ok(en.right && en.wrong && en.lead && en.diagram && en.tool.label, `${page.slug} en copy`);
    assert.ok(!/[֐-׿]/.test(JSON.stringify(en.points)), `${page.slug} en contains Hebrew`);
  }
});

test('the fixed disclaimer is at the top of every Hebrew and English page, including hubs', () => {
  for (const page of PAGES) {
    const he = renderPage(page, 'he');
    assert.ok(he.includes(TOP_DISCLAIMER_HE), `${page.slug} he missing disclaimer`);
    assert.ok(he.indexOf(TOP_DISCLAIMER_HE) < he.indexOf('id="key-points"'), `${page.slug} disclaimer not at top`);
    assert.ok(renderPage(getPage(page.slug, 'en'), 'en').includes('For educational purposes only'), `${page.slug} en`);
  }
  assert.ok(renderHub('he').includes(TOP_DISCLAIMER_HE));
  assert.ok(renderHub('en').includes('For educational purposes only'));
});

test('GET /learn renders a crawlable Hebrew hub linking to every page', async () => {
  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/learn`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html lang="he" dir="rtl">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/capitalflow\.vip\/learn">/);
    for (const page of PAGES) assert.ok(html.includes(`href="/learn/${page.slug}"`), page.slug);
  } finally {
    server.close();
  }
});

test('GET /learn/:slug renders full article HTML with canonical, hreflang, structured data and disclaimer', async () => {
  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/learn/relative-volume-rvol`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<h1><bdi>RVOL</bdi> — נפח יחסי</h1>'), 'h1 isolates the Latin term');
    assert.match(html, /<svg [^>]*role="img"/);
    assert.match(html, /<link rel="canonical" href="https:\/\/capitalflow\.vip\/learn\/relative-volume-rvol">/);
    assert.match(html, /hreflang="en" href="https:\/\/capitalflow\.vip\/en\/learn\/relative-volume-rvol"/);
    assert.match(html, /"@type":"FAQPage"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /זה לא ייעוץ השקעות/);
    assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(html), 'no executable scripts on content pages');
  } finally {
    server.close();
  }
});

test('GET /en/learn/:slug serves the English page left-to-right with a Hebrew alternate', async () => {
  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/en/learn/moving-average-150`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html lang="en" dir="ltr">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/capitalflow\.vip\/en\/learn\/moving-average-150">/);
    assert.match(html, /hreflang="he" href="https:\/\/capitalflow\.vip\/learn\/moving-average-150"/);
    assert.match(html, /<h1>The 150-day moving average/);
  } finally {
    server.close();
  }
});

test('unknown or malformed learning slugs fall through instead of rendering', async () => {
  const server = await startApp();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.strictEqual((await fetch(`${base}/learn/not-a-real-page`)).status, 404);
    assert.strictEqual((await fetch(`${base}/en/learn/not-a-real-page`)).status, 404);
    assert.strictEqual((await fetch(`${base}/learn/..%2Fpolicy`)).status, 404);
  } finally {
    server.close();
  }
});
