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

test('FMP rejects a quote without a provider timestamp', () => {
  assert.equal(
    fmp.normalizeFmpQuote(
      { symbol: 'MISSING_TIME', price: 10, volume: 1000, avgVolume: 900, marketCap: 1000000 },
      'MISSING_TIME'
    ),
    null
  );
});
