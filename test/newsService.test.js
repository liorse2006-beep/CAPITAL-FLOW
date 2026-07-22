// Per-symbol news fallback chain (server/services/newsService.js): Finnhub
// → Massive → MarketAux, and the golden rule that drives it — never
// fabricate an article; an exhausted chain must report an empty result,
// not invented content.
require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.MASSIVE_API_KEY = 'test-massive-key';
process.env.MARKETAUX_API_KEY = 'test-marketaux-key';
delete require.cache[require.resolve('../server/config')];

// finnhubFetch is destructured (by value) into newsService at require time,
// so it must be mocked on the already-cached finnhub module *before*
// newsService is (re-)required — otherwise this test would hit the real
// Finnhub API using whatever key happens to be in the local .env.
const finnhubModule = require('../server/services/finnhub');
const originalFinnhubFetch = finnhubModule.finnhubFetch;
finnhubModule.finnhubFetch = async () => null;

delete require.cache[require.resolve('../server/services/newsService')];
const { fetchNewsForSymbol } = require('../server/services/newsService');

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
  finnhubModule.finnhubFetch = originalFinnhubFetch;
});

function jsonResponse(body, ok) {
  return { ok: ok !== false, json: async () => body };
}

// Finnhub is never reached in this test env (no FINNHUB_API_KEY configured,
// see finnhubKeyPool) — finnhubFetch short-circuits to null without any
// network call, so every test here exercises Massive/MarketAux only.

test('falls back to Massive when Finnhub has nothing', async () => {
  global.fetch = async (url) => {
    assert.match(url, /api\.massive\.com/);
    return jsonResponse({
      results: [
        {
          title: 'Massive headline',
          publisher: { name: 'Massive Wire' },
          published_utc: '2026-01-01T00:00:00Z',
          article_url: 'https://example.com/a',
          image_url: '',
        },
      ],
    });
  };

  const result = await fetchNewsForSymbol('MSVE');
  assert.strictEqual(result.source, 'massive');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].headline, 'Massive headline');
});

test('falls back to MarketAux when both Finnhub and Massive have nothing', async () => {
  global.fetch = async (url) => {
    if (url.includes('massive.com')) return jsonResponse({ results: [] });
    assert.match(url, /api\.marketaux\.com/);
    return jsonResponse({
      data: [
        {
          title: 'MarketAux headline',
          source: 'MarketAux Wire',
          published_at: '2026-01-01T00:00:00Z',
          url: 'https://example.com/b',
          sentiment: 'positive',
        },
      ],
    });
  };

  const result = await fetchNewsForSymbol('MTAX');
  assert.strictEqual(result.source, 'marketaux');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].sentiment, 'positive');
});

test('every provider empty → reports zero articles, never invents content', async () => {
  global.fetch = async () => jsonResponse({ results: [], data: [] });

  const result = await fetchNewsForSymbol('NOWT');
  assert.deepStrictEqual(result.articles, []);
  assert.strictEqual(result.source, null);
});

test('a provider erroring out is treated the same as empty — chain keeps going', async () => {
  global.fetch = async (url) => {
    if (url.includes('massive.com')) throw new Error('network down');
    return jsonResponse({
      data: [{ title: 'Recovered via MarketAux', source: 'X', published_at: '2026-01-01T00:00:00Z', url: 'https://x.com' }],
    });
  };

  const result = await fetchNewsForSymbol('RECV');
  assert.strictEqual(result.source, 'marketaux');
  assert.strictEqual(result.articles.length, 1);
});

test('a successful result is cached for subsequent calls within the TTL', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    // Serves both the Massive lookup and the summarizer's Gemini call —
    // the summarizer just fails to parse this shape and returns null,
    // which is fine, only the call *count* matters for this test.
    return jsonResponse({
      results: [{ title: 'Cached headline', publisher: {}, published_utc: '2026-01-01T00:00:00Z', article_url: 'https://x.com' }],
    });
  };

  await fetchNewsForSymbol('CACH');
  const callsAfterFirst = calls;
  await fetchNewsForSymbol('CACH');
  assert.strictEqual(calls, callsAfterFirst, 'the second call must be served from cache, not refetched at all');
});

test('a successful Gemini summary is merged onto the article, but real provider sentiment wins over the AI guess', async () => {
  global.fetch = async (url) => {
    if (url.includes('massive.com')) {
      return jsonResponse({
        results: [
          {
            title: 'Enriched headline',
            description: 'Real description text.',
            publisher: { name: 'Wire' },
            published_utc: '2026-01-01T00:00:00Z',
            article_url: 'https://x.com/enriched',
            insights: [{ ticker: 'ENRI', sentiment: 'negative' }],
          },
        ],
      });
    }
    // Gemini call
    return jsonResponse({
      output_text: JSON.stringify([
        { index: 1, summary: 'Two sentence AI summary.', sentiment: 'positive', impact: 'This may add volatility.' },
      ]),
    });
  };

  const result = await fetchNewsForSymbol('ENRI');
  const article = result.articles[0];
  assert.strictEqual(article.summary, 'Two sentence AI summary.');
  assert.strictEqual(article.impact, 'This may add volatility.');
  assert.strictEqual(article.sentiment, 'negative', "Massive's real per-ticker sentiment must win over Gemini's guess");
});

test('summarizer failure leaves the raw article untouched — no summary field appears', async () => {
  global.fetch = async (url) => {
    if (url.includes('massive.com')) {
      return jsonResponse({
        results: [{ title: 'Unenriched headline', publisher: {}, published_utc: '2026-01-01T00:00:00Z', article_url: 'https://x.com' }],
      });
    }
    return jsonResponse({ output_text: 'not valid json' });
  };

  const result = await fetchNewsForSymbol('RAWW');
  assert.strictEqual(result.articles[0].summary, undefined);
  assert.strictEqual(result.articles[0].headline, 'Unenriched headline');
});
