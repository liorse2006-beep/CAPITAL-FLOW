const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const db = require('../server/db');
const { insightsFor } = require('../server/stocks/insights');
const { movingAverages, snapshotDue } = require('../server/stocks/snapshot');
const { resetSnapshotCache, isIndexable } = require('../server/stocks/store');
const { slugFor, symbolForSlug, SYMBOLS } = require('../server/stocks/universe');
const { ETF_SYMBOLS } = require('../server/stocks/etfs');

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

test('snapshots target the last completed session and run once per session', async () => {
  await seed([]);
  await db.prepare("DELETE FROM app_meta WHERE key = 'stock_snapshot_session'").run();
  assert.strictEqual(
    await snapshotDue(new Date('2026-11-17T17:00:00Z')),
    '2026-11-16',
    'during trading it fills the last completed session'
  );
  assert.strictEqual(await snapshotDue(new Date('2026-11-17T21:30:00Z')), null, 'too soon after the close');
  assert.strictEqual(await snapshotDue(new Date('2026-11-17T23:00:00Z')), '2026-11-17');
  await db.prepare("INSERT INTO app_meta (key, value) VALUES ('stock_snapshot_session', '2026-11-17')").run();
  assert.strictEqual(
    await snapshotDue(new Date('2026-11-17T23:30:00Z')),
    '2026-11-17',
    'a marker from a smaller symbol list is not done'
  );
  await db
    .prepare("UPDATE app_meta SET value = ? WHERE key = 'stock_snapshot_session'")
    .run(`2026-11-17#${SYMBOLS.length + ETF_SYMBOLS.length}`);
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

const TOP_DISCLAIMER_EN =
  'For educational purposes only and not a recommendation to act. Data may be delayed or inaccurate, and its accuracy is not guaranteed.';

const SPY = {
  symbol: 'SPY',
  kind: 'etf',
  session: '2026-11-16',
  asOf: Date.parse('2026-11-16T23:00:00Z'),
  name: 'SPDR S&P 500 ETF Trust',
  price: 640.12,
  changePct: 0.4,
  volume: 70e6,
  avgVolume3m: 65e6,
  high52: 690,
  low52: 520,
  sma20: 650,
  sma50: 645,
  sma150: 620,
  sma150Prev20: 610,
  holdings: [
    { symbol: 'NVDA', name: 'NVIDIA Corp', weight: 0.075 },
    { symbol: 'MSFT', name: 'Microsoft Corp', weight: 0.065 },
    { symbol: 'AAPL', name: 'Apple Inc', weight: 0.06 },
  ],
  family: 'State Street',
  expenseRatio: 0.000945,
  totalAssets: 6.5e11,
  yield: 0.012,
};

test('English stock pages mirror the Hebrew ones with their own disclaimer and hreflang', async () => {
  await seed([NVDA, { ...NVDA, symbol: 'AMD', name: 'Advanced Micro Devices', marketCap: 3e11 }]);
  const server = await startApp();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await (await fetch(`${base}/en/stocks/nvda`)).text();
    assert.match(html, /<html lang="en" dir="ltr">/);
    assert.match(html, /<title>NVIDIA \(NVDA\) Stock/);
    assert.ok(html.includes(TOP_DISCLAIMER_EN), 'top disclaimer');
    assert.ok(html.includes('Start scanning'), 'scan CTA');
    assert.ok(html.includes('href="/en/stocks/amd"'), 'English peer link');
    assert.ok(html.includes('hreflang="he" href="https://capitalflow.vip/stocks/nvda"'));
    assert.ok(!/[\u0590-\u05FF]/.test(html.split('<main')[1].split('</main>')[0]), 'no Hebrew in the English body');
    const hub = await (await fetch(`${base}/en/stocks`)).text();
    assert.ok(hub.includes(TOP_DISCLAIMER_EN));
    assert.ok(hub.includes('href="/en/stocks/nvda"'));
  } finally {
    server.close();
  }
});

test('ETF pages show holdings, link to stock pages and enter the sitemap only with data', async () => {
  await seed([NVDA, SPY]);
  const server = await startApp();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [path, disclaimer, stockLink] of [
      ['/etfs/spy', TOP_DISCLAIMER_HE, 'href="/stocks/nvda"'],
      ['/en/etfs/spy', TOP_DISCLAIMER_EN, 'href="/en/stocks/nvda"'],
    ]) {
      const res = await fetch(base + path);
      assert.strictEqual(res.status, 200, path);
      const html = await res.text();
      assert.ok(html.includes(disclaimer), `${path} disclaimer`);
      assert.ok(html.includes(stockLink), `${path} holding links to the stock page`);
      assert.ok(html.includes('7.5%'), `${path} holding weight`);
      assert.match(html, /<meta name="robots" content="index, follow/);
    }
    assert.strictEqual((await fetch(`${base}/etfs/SPY`, { redirect: 'manual' })).status, 301);
    assert.strictEqual((await fetch(`${base}/etfs/nope`)).status, 404);
    const pending = await (await fetch(`${base}/etfs/qqq`)).text();
    assert.match(pending, /<meta name="robots" content="noindex, follow">/);
    assert.ok(pending.includes(TOP_DISCLAIMER_HE));
    for (const hubPath of ['/etfs', '/en/etfs']) {
      const hub = await (await fetch(base + hubPath)).text();
      assert.ok(hub.includes(hubPath === '/etfs' ? TOP_DISCLAIMER_HE : TOP_DISCLAIMER_EN), hubPath);
    }
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    for (const loc of ['/etfs/spy', '/en/etfs/spy', '/en/stocks/nvda', '/etfs', '/en/stocks'])
      assert.ok(sitemap.includes(`<loc>https://capitalflow.vip${loc}</loc>`), loc);
    assert.ok(!sitemap.includes('/etfs/qqq'));
  } finally {
    server.close();
  }
});
