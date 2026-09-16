// FMP integration tests use a fake key and a mocked fetch. They verify the
// secret stays in the request header and that malformed/incomplete provider
// rows are rejected without contacting the real provider.
process.env.FMP_API_KEY = 'test-fmp-key-' + 'x'.repeat(32);
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fmp = require('../server/services/fmp');

test.after(() => fmp.clearCache());

test('FMP quote requests use a server header and never put the key in the URL', async (t) => {
  const symbol = 'AUDIT_FMP_HEADER';
  let observedUrl = '';
  let observedKey = '';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    observedUrl = String(url);
    observedKey = String(options?.headers?.apikey || '');
    return {
      ok: true,
      status: 200,
      json: async () => [
        {
          symbol,
          price: 123.45,
          volume: 100000,
          avgVolume: 90000,
          marketCap: 1000000000,
          timestamp: Math.floor(Date.now() / 1000),
        },
      ],
    };
  });

  const rows = await fmp.fetchFmpQuotes([symbol]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, symbol);
  assert.equal(rows[0].regularMarketPrice, 123.45);
  assert.equal(observedKey, process.env.FMP_API_KEY);
  assert.ok(!observedUrl.includes(process.env.FMP_API_KEY));
  assert.ok(observedUrl.includes('/batch-quote?symbols='));
});

test('FMP falls back to server-side single quotes when batch delivery is restricted', async (t) => {
  const symbols = ['AUDIT_FMP_SINGLE_A', 'AUDIT_FMP_SINGLE_B'];
  const requestedUrls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requestedUrls.push(String(url));
    assert.equal(String(options?.headers?.apikey || ''), process.env.FMP_API_KEY);
    if (String(url).includes('/batch-quote?')) {
      return { ok: false, status: 402, json: async () => ({}) };
    }
    const symbol = new URL(String(url)).searchParams.get('symbol');
    return {
      ok: true,
      status: 200,
      json: async () => [
        {
          symbol,
          price: 123.45,
          volume: 100000,
          timestamp: Math.floor(Date.now() / 1000),
        },
      ],
    };
  });

  const rows = await fmp.fetchFmpQuotes(symbols);

  assert.deepEqual(rows.map((row) => row.symbol).sort(), symbols.sort());
  assert.ok(requestedUrls.some((url) => url.includes('/batch-quote?')));
  assert.equal(requestedUrls.filter((url) => url.includes('/quote?symbol=')).length, symbols.length);
  assert.ok(requestedUrls.every((url) => !url.includes(process.env.FMP_API_KEY)));
});

test('FMP rejects a quote without a provider timestamp', () => {
  assert.equal(
    fmp.normalizeFmpQuote(
      { symbol: 'MISSING_TIME', price: 10, volume: 1000, avgVolume: 900, marketCap: 1000000 },
      'MISSING_TIME'
    ),
    null
  );
});
