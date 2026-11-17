const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const db = require('../server/db');
const { insightsFor } = require('../server/stocks/insights');
const { movingAverages, snapshotDue } = require('../server/stocks/snapshot');
const { resetSnapshotCache, isIndexable } = require('../server/stocks/store');
const { slugFor, symbolForSlug, SYMBOLS } = require('../server/stocks/universe');

const TOP_DISCLAIMER_HE =
  'התוכן לצורכי לימוד בלבד ואינו המלצה לפעולה. הנתונים עשויים להיות מעוכבים או לא מדויקים, ואין התחייבות לנכונותם.';

const NVDA = {
  symbol: 'NVDA',
  session: '2026-11-16',
  asOf: Date.parse('2026-11-16T23:00:00Z'),
  name: 'NVIDIA Corporation',
  price: 153.31,
  changePct: -1.81,
  marketCap: 3.7e12,
  volume: 300e6,
  avgVolume3m: 150e6,
  high52: 243.37,
  low52: 148.8,
  sma20: 192.49,
  sma50: 211.72,
  sma150: 211.01,
  sma150Prev20: 209.26,
  sector: 'Technology',
  industry: 'Semiconductors',
  city: 'Santa Clara',
  country: 'United States',
  employees: 42000,
  pe: 19.5,
  forwardPE: 9.7,
  peg: 0.2,
  debtToEquity: 0.15,
  revenueGrowth5Y: 66.9,
  floatShares: 23.1e9,
  shortPercent: 0.012,
  nextEarningsDate: '2026-11-19',
};

async function seed(snapshots) {
  await db.ready;
  await db.prepare('DELETE FROM stock_snapshots').run();
  for (const s of snapshots) {
    await db
      .prepare('INSERT INTO stock_snapshots (symbol, data, updated_at) VALUES (?, ?, ?)')
      .run(s.symbol, JSON.stringify(s), 1);
  }
  resetSnapshotCache();
}

function startApp() {
  const app = express();
  app.use('/', require('../server/routes/sitemap').router);
  app.use('/', require('../server/routes/stocks'));
  app.use((req, res) => res.status(404).send('not found'));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('slugs round-trip for every symbol, including class shares', () => {
  for (const symbol of SYMBOLS) assert.strictEqual(symbolForSlug(slugFor(symbol)), symbol);
  assert.strictEqual(slugFor('BRK.B'), 'brk-b');
  assert.ok(SYMBOLS.length >= 450, 'universe covers the S&P 500 and Nasdaq-100');
});

test('moving averages need enough history and never invent a value', () => {
  const closes = Array.from({ length: 170 }, (_, i) => i + 1);
  const ma = movingAverages(closes);
  assert.strictEqual(ma.sma20, (151 + 170) / 2);
  assert.strictEqual(ma.sma150, (21 + 170) / 2);
  assert.strictEqual(ma.sma150Prev20, (1 + 150) / 2);
  assert.deepStrictEqual(movingAverages(closes.slice(0, 40)), {
    sma20: 30.5,
    sma50: null,
    sma150: null,
    sma150Prev20: null,
  });
});

test('insights state measured facts and skip anything without data', () => {
  const lines = insightsFor(NVDA, '2026-11-17');
  assert.match(lines[0], /^המחיר 27% מתחת לממוצע 150 יום, והממוצע עצמו עולה\.$/);
  assert.match(lines[1], /קרוב לשפל של השנה האחרונה/);
  assert.match(lines[2], /פי 2\.0 מהממוצע/);
  assert.match(lines[3], /דוח רבעוני צפוי ב-19\.11\.2026, בעוד 2 ימים/);
  assert.ok(!lines.some((line) => /קנו|מכרו|כדאי|המלצה/.test(line)), 'no advice language');
  assert.deepStrictEqual(insightsFor({ symbol: 'X' }, '2026-11-17'), []);
});

test('a page is indexable only with core data', () => {
  assert.ok(isIndexable(NVDA));
  assert.ok(!isIndexable({ ...NVDA, sector: null }));
  assert.ok(!isIndexable({ ...NVDA, sma50: null, sma150: null }));
});

test('snapshots never run during the regular session and run once per session', async () => {
  await seed([]);
  await db.prepare("DELETE FROM app_meta WHERE key = 'stock_snapshot_session'").run();
  assert.strictEqual(await snapshotDue(new Date('2026-11-17T17:00:00Z')), null, 'market open');
  assert.strictEqual(await snapshotDue(new Date('2026-11-17T21:30:00Z')), null, 'too soon after the close');
  assert.strictEqual(await snapshotDue(new Date('2026-11-17T23:00:00Z')), '2026-11-17');
  await db.prepare("INSERT INTO app_meta (key, value) VALUES ('stock_snapshot_session', '2026-11-17')").run();
  assert.strictEqual(await snapshotDue(new Date('2026-11-17T23:30:00Z')), null, 'already done');
});

test('GET /stocks/:slug renders data, the fixed top disclaimer, the scan CTA and no source line', async () => {
  await seed([NVDA, { ...NVDA, symbol: 'AMD', name: 'Advanced Micro Devices', marketCap: 3e11 }]);
  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/stocks/nvda`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>מניית אנבידיה \(NVDA\)/);
    assert.ok(html.includes(TOP_DISCLAIMER_HE), 'top disclaimer');
    assert.ok(html.indexOf(TOP_DISCLAIMER_HE) < html.indexOf('מה הנתונים מראים'), 'disclaimer above the data');
    assert.ok(html.includes('התחל לסרוק'), 'scan CTA');
    assert.ok(!/Yahoo|Finnhub|מקורות/.test(html.split('<body>')[1]), 'no data-source line on the page');
    assert.match(html, /<meta name="robots" content="index, follow/);
    assert.ok(html.includes('href="/stocks/amd"'), 'links to a peer');
  } finally {
    server.close();
  }
});

test('stocks without data are noindex and left out of the sitemap', async () => {
  await seed([NVDA]);
  const server = await startApp();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const pending = await (await fetch(`${base}/stocks/aapl`)).text();
    assert.match(pending, /<meta name="robots" content="noindex, follow">/);
    assert.ok(pending.includes(TOP_DISCLAIMER_HE));
    assert.strictEqual((await fetch(`${base}/stocks/not-a-ticker`)).status, 404);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(sitemap.includes('<loc>https://capitalflow.vip/stocks/nvda</loc>'));
    assert.ok(!sitemap.includes('/stocks/aapl'));
    assert.ok(sitemap.includes('<loc>https://capitalflow.vip/learn/rsi</loc>'));
    assert.ok(sitemap.includes('<loc>https://capitalflow.vip/en/learn/rsi</loc>'));
    const hub = await (await fetch(`${base}/stocks`)).text();
    assert.ok(hub.includes(TOP_DISCLAIMER_HE));
    for (const symbol of SYMBOLS) assert.ok(hub.includes(`href="/stocks/${slugFor(symbol)}"`), symbol);
  } finally {
    server.close();
  }
});
