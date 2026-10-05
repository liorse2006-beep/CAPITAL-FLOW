// HTTP-level chart safety tests. A chart must never turn an empty or malformed
// provider response into a successful-looking blank/current quote payload.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../server/db');
const yahoo = require('../server/services/yahoo');
const { issueToken } = require('../server/services/auth');
const chartRouter = require('../server/routes/chart');

before(async () => {
  await db.ready;
});

async function makeUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'premium', 1)")
    .run(email);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  return (await issueToken(user)).accessToken;
}

function startTestApp(router = chartRouter) {
  const app = express();
  app.use('/api', router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function validCandle() {
  return {
    date: new Date(Date.now() - 10 * 86400000),
    open: 99,
    high: 102,
    low: 98,
    close: 101,
    volume: 1000000,
  };
}

test('GET /api/chart returns unavailable when no complete historical candle exists', async (t) => {
  t.mock.method(yahoo, 'chart', async () => ({ quotes: [{ date: new Date(), close: 100 }] }));
  const token = await makeUser('chart-empty@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chart/CHARTEMPTY`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /not available right now/i);
    assert.equal(body.dataStatus, 'unavailable');
    assert.equal(body.quoteDataStatus, 'unavailable');
  } finally {
    server.close();
  }
});

function validQuote(symbol) {
  return {
    symbol,
    currency: 'USD',
    regularMarketPrice: 101,
    regularMarketTime: new Date(),
    regularMarketChangePercent: 1,
    regularMarketDayHigh: 102,
    regularMarketDayLow: 98,
    regularMarketPreviousClose: 100,
  };
}

function validChart(symbol, candle = validCandle()) {
  return { meta: { symbol, currency: 'USD' }, quotes: [candle] };
}

function freshChartRouter() {
  delete require.cache[require.resolve('../server/routes/chart')];
  return require('../server/routes/chart');
}

test('chart OHLCV cannot manufacture numbers from boolean provider fields', async (t) => {
  const symbol = 'CHARTBOOL';
  t.mock.method(yahoo, 'chart', async () => validChart(symbol, { ...validCandle(), volume: true }));
  t.mock.method(yahoo, 'quote', async () => validQuote(symbol));
  const token = await makeUser('chart-bool@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 503);
  } finally {
    server.close();
  }
});

for (const [name, change] of [
  ['undated', { regularMarketTime: undefined }],
  ['old', { regularMarketTime: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }],
  ['future', { regularMarketTime: new Date(Date.now() + 60 * 60 * 1000) }],
  ['wrong-symbol', { symbol: 'DIFFERENT' }],
  ['boolean', { regularMarketPrice: true }],
  ['unknown-currency', { currency: undefined }],
]) {
  test(`chart current quote rejects ${name} evidence without discarding valid history`, async (t) => {
    const symbol = 'CHARTSAFE';
    const finnhub = require('../server/services/finnhub');
    t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
    t.mock.method(yahoo, 'chart', async () => validChart(symbol));
    t.mock.method(yahoo, 'quote', async () => ({ ...validQuote(symbol), ...change }));
    const token = await makeUser(`chart-${name}@test.local`);
    const server = await startTestApp(freshChartRouter());
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.quotes.length, 1);
      assert.equal(body.currentPrice, null);
      assert.equal(body.dataProvenance.quoteStatus, 'unavailable');
    } finally {
      server.close();
    }
  });
}

test('chart keeps complete historical data and an independently verified current quote', async (t) => {
  const symbol = 'CHARTGOOD';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'chart', async () => validChart(symbol));
  t.mock.method(yahoo, 'quote', async () => validQuote(symbol));
  const token = await makeUser('chart-good@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.currentPrice.price, 101);
    assert.equal(body.dataProvenance.quoteStatus, 'complete');
  } finally {
    server.close();
  }
});

test('partial Finnhub enrichment cannot be relabeled complete by the chart response', async (t) => {
  const symbol = 'CHARTPART';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => ({
    price: 101,
    change: 1,
    dayHigh: null,
    dayLow: 98,
    prevClose: 100,
    dataAsOf: new Date().toISOString(),
    dataStatus: 'partial',
    missingFields: ['h'],
  }));
  t.mock.method(yahoo, 'chart', async () => validChart(symbol));
  const token = await makeUser('chart-partial@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.currentPrice.price, 101);
    assert.equal(body.currentPrice.high, null);
    assert.equal(body.dataProvenance.quoteStatus, 'partial');
  } finally {
    server.close();
  }
});

test('GET /api/chart does not expose a malformed Yahoo current price', async (t) => {
  t.mock.method(yahoo, 'chart', async () => validChart('BADPRICE'));
  t.mock.method(yahoo, 'quote', async () => ({ symbol: 'BADPRICE', regularMarketPrice: 'not-a-number' }));
  const token = await makeUser('chart-bad-price@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chart/BADPRICE`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.quotes.length, 1);
    assert.equal(body.currentPrice, null);
  } finally {
    server.close();
  }
});

for (const [name, change] of [
  ['wrong instrument', { symbol: 'OTHER' }],
  ['unknown instrument', { symbol: undefined }],
  ['wrong currency', { currency: 'EUR' }],
  ['unknown currency', { currency: undefined }],
]) {
  test(`chart rejects historical ${name} rather than applying a requested dollar label`, async (t) => {
    const symbol = 'CHARTUNIT';
    t.mock.method(yahoo, 'chart', async () => ({
      ...validChart(symbol),
      meta: { symbol, currency: 'USD', ...change },
    }));
    const token = await makeUser(`chart-meta-${name.replaceAll(' ', '-')}@test.local`);
    const server = await startTestApp(freshChartRouter());
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).dataProvenance.status, 'unavailable');
    } finally {
      server.close();
    }
  });
}

for (const [name, candle] of [
  ['inverted OHLC', { ...validCandle(), high: 97 }],
  ['future bar', { ...validCandle(), date: new Date(Date.now() + 86400000) }],
  ['outside requested period', { ...validCandle(), date: new Date(Date.now() - 90 * 86400000) }],
]) {
  test(`chart excludes ${name} without manufacturing a replacement`, async (t) => {
    const symbol = 'CHARTBAR';
    t.mock.method(yahoo, 'chart', async () => validChart(symbol, candle));
    const token = await makeUser(`chart-bar-${name.replaceAll(' ', '-')}@test.local`);
    const server = await startTestApp(freshChartRouter());
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      assert.equal(response.status, 503);
    } finally {
      server.close();
    }
  });
}

test('valid tiny OHLC values retain their precision instead of rounding to zero', async (t) => {
  const symbol = 'CHARTTINY';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'quote', async () => null);
  t.mock.method(yahoo, 'chart', async () =>
    validChart(symbol, {
      ...validCandle(),
      open: 0.00002,
      high: 0.00003,
      low: 0.00001,
      close: 0.000025,
    })
  );
  const token = await makeUser('chart-tiny@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.quotes[0].close, 0.000025);
    assert.equal(body.quotes[0].low, 0.00001);
    assert.equal(body.currentPrice, null);
  } finally {
    server.close();
  }
});

test('history-only chart retains sorted older bars and moving averages without a fabricated current price', async (t) => {
  const symbol = 'CHARTMA';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'quote', async () => null);
  const candles = Array.from({ length: 60 }, (_, index) => ({
    ...validCandle(),
    date: new Date(Date.now() - (index + 2) * 86400000),
  }));
  t.mock.method(yahoo, 'chart', async () => ({ ...validChart(symbol), quotes: candles }));
  const token = await makeUser('chart-ma@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}?period=3M`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.quotes.length, 60);
    assert.ok(body.quotes[0].date < body.quotes[59].date);
    assert.equal(body.currentPrice, null);
    assert.equal(body.ma20[18], null);
    assert.equal(body.ma20[19], 101);
    assert.equal(body.ma50[48], null);
    assert.equal(body.ma50[49], 101);
  } finally {
    server.close();
  }
});

test('filtered historical candles keep usable history explicitly partial', async (t) => {
  const symbol = 'CHARTHPART';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'quote', async () => null);
  t.mock.method(yahoo, 'chart', async () => ({
    ...validChart(symbol),
    quotes: [validCandle(), { ...validCandle(), high: null }],
  }));
  const token = await makeUser('chart-h-part@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.quotes.length, 1);
    assert.equal(body.dataProvenance.status, 'partial');
    assert.equal(body.dataProvenance.sources[0].status, 'partial');
  } finally {
    server.close();
  }
});

test('explicit class-share alias preserves the requested instrument label and verified USD units', async (t) => {
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'chart', async (symbol) => {
    assert.equal(symbol, 'BRK-B');
    return validChart(symbol);
  });
  t.mock.method(yahoo, 'quote', async (symbol) => {
    assert.equal(symbol, 'BRK-B');
    return validQuote(symbol);
  });
  const token = await makeUser('chart-alias@test.local');
  const server = await startTestApp(freshChartRouter());
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/BRK.B`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.symbol, 'BRK.B');
    assert.equal(body.currency, 'USD');
    assert.equal(body.currentPrice.price, 101);
  } finally {
    server.close();
  }
});

test('warm chart cache cannot keep a current price after its provider timestamp becomes stale', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-15T16:00:00.000Z') });
  const symbol = 'CHARTCACHE';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'chart', async () => validChart(symbol));
  const originalTime = new Date(Date.now() - (44 * 60 + 50) * 1000);
  let quoteCalls = 0;
  t.mock.method(yahoo, 'quote', async () => {
    quoteCalls++;
    return { ...validQuote(symbol), regularMarketTime: originalTime };
  });
  const token = await makeUser('chart-cache@test.local');
  const server = await startTestApp(freshChartRouter());
  const url = `http://127.0.0.1:${server.address().port}/api/chart/${symbol}`;
  const options = { headers: { Authorization: 'Bearer ' + token } };
  try {
    const first = await fetch(url, options);
    assert.equal((await first.json()).currentPrice.price, 101);
    const warm = await fetch(url, options);
    assert.equal((await warm.json()).currentPrice.price, 101);
    assert.equal(quoteCalls, 1);
    t.mock.timers.tick(30_000);
    const expiredQuote = await fetch(url, options);
    assert.equal(expiredQuote.status, 200);
    const body = await expiredQuote.json();
    assert.equal(body.currentPrice, null);
    assert.equal(body.quotes.length, 1);
    assert.equal(quoteCalls, 2);
  } finally {
    server.close();
  }
});

test('public chart keeps customer data-quality states when provider diagnostics are stripped', async (t) => {
  const symbol = 'CHARTPUB';
  const finnhub = require('../server/services/finnhub');
  t.mock.method(finnhub, 'fetchFinnhubQuote', async () => null);
  t.mock.method(yahoo, 'quote', async () => null);
  t.mock.method(yahoo, 'chart', async () => ({
    ...validChart(symbol),
    quotes: [validCandle(), { ...validCandle(), high: null }],
  }));
  const app = express();
  app.use(require('../server/middleware/publicResponseSanitizer').publicResponseSanitizer);
  app.use('/api', freshChartRouter());
  const token = await makeUser('chart-public@test.local');
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chart/${symbol}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.dataProvenance, undefined);
      assert.equal(body.dataStatus, 'partial');
      assert.equal(body.quoteDataStatus, 'unavailable');
      assert.equal(body.currentPrice, null);
    }
  } finally {
    server.close();
  }
});
