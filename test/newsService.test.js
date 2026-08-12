// Per-symbol news fallback chain (server/services/newsService.js): Finnhub
// → Massive → MarketAux → NewsData.io, and the golden rule that drives it —
// never fabricate an article; an exhausted chain must report an empty
// result, not invented content.
require('./helpers/testEnv');
const { test, after } = require('node:test');
const assert = require('node:assert');

process.env.MASSIVE_API_KEY = 'test-massive-key';
process.env.MARKETAUX_API_KEY = 'test-marketaux-key';
process.env.NEWSDATA_API_KEY = 'test-newsdata-key';
// The enrichment test below mocks Gemini's HTTP response. Set a fake key so
// the test exercises that branch identically in CI, where the real developer
// .env is intentionally absent, and locally, where it may be present.
process.env.GOOGLE_AI_STUDIO_KEY = 'test-gemini-key';
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

// fetchNewsForSymbol now issues one extra HEAD request per article (the
// redirect-resolution step that fixes source mislabeling — see the
// dedicated test below) after the provider lookup succeeds. Every other
// test's fetch mock only cares about the GET call it's testing; this wraps
// it so a HEAD request passes straight through as "no redirect" instead of
// accidentally falling into a GET-shaped branch and getting a nonsense
// response that only "works" because resolveFinalUrl's own fallback
// swallows the mismatch.
function withHeadPassthrough(getHandler) {
  return async (url, options) => {
    if (options && options.method === 'HEAD') return { ok: true, url };
    return getHandler(url);
  };
}

// Finnhub is never reached in this test env (no FINNHUB_API_KEY configured,
// see finnhubKeyPool) — finnhubFetch short-circuits to null without any
// network call, so every test here exercises Massive/MarketAux only.

test('falls back to Massive when Finnhub has nothing', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
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
  });

  const result = await fetchNewsForSymbol('MSVE');
  assert.strictEqual(result.source, 'massive');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].headline, 'Massive headline');
});

test('falls back to MarketAux when both Finnhub and Massive have nothing', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
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
  });

  const result = await fetchNewsForSymbol('MTAX');
  assert.strictEqual(result.source, 'marketaux');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].sentiment, 'positive');
});

test('falls back to NewsData.io when Finnhub, Massive, and MarketAux all have nothing', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
    if (url.includes('massive.com')) return jsonResponse({ results: [] });
    if (url.includes('marketaux.com')) return jsonResponse({ data: [] });
    assert.match(url, /newsdata\.io/);
    return jsonResponse({
      results: [
        {
          title: 'NDAT posts strong quarterly results',
          description: 'A snippet of the article.',
          source_id: 'newsdata_wire',
          pubDate: '2026-01-01 00:00:00',
          link: 'https://example.com/c',
        },
      ],
    });
  });

  const result = await fetchNewsForSymbol('NDAT');
  assert.strictEqual(result.source, 'newsdata');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].headline, 'NDAT posts strong quarterly results');
});

test('NewsData.io results that never actually mention the ticker are dropped — its search is generic full-text, unlike the other providers', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
    if (url.includes('massive.com')) return jsonResponse({ results: [] });
    if (url.includes('marketaux.com')) return jsonResponse({ data: [] });
    assert.match(url, /newsdata\.io/);
    return jsonResponse({
      results: [
        {
          title: 'Completely unrelated market roundup',
          description: 'General commentary with no ticker mention.',
          link: 'https://example.com/unrelated',
        },
        {
          title: 'ALLX reports strong demand',
          description: 'ALLX shares moved on the news.',
          link: 'https://example.com/real',
        },
      ],
    });
  });

  const result = await fetchNewsForSymbol('ALLX');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].headline, 'ALLX reports strong demand');
});

test('every provider empty → reports zero articles, never invents content', async () => {
  global.fetch = async () => jsonResponse({ results: [], data: [] });

  const result = await fetchNewsForSymbol('NOWT');
  assert.deepStrictEqual(result.articles, []);
  assert.strictEqual(result.source, null);
});

test('a provider erroring out is treated the same as empty — chain keeps going', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
    if (url.includes('massive.com')) throw new Error('network down');
    return jsonResponse({
      data: [
        { title: 'Recovered via MarketAux', source: 'X', published_at: '2026-01-01T00:00:00Z', url: 'https://x.com' },
      ],
    });
  });

  const result = await fetchNewsForSymbol('RECV');
  assert.strictEqual(result.source, 'marketaux');
  assert.strictEqual(result.articles.length, 1);
});

test('a successful result is cached for subsequent calls within the TTL', async () => {
  let calls = 0;
  global.fetch = withHeadPassthrough(async () => {
    calls++;
    // Serves both the Massive lookup and the summarizer's Gemini call —
    // the summarizer just fails to parse this shape and returns null,
    // which is fine, only the call *count* matters for this test.
    return jsonResponse({
      results: [
        {
          title: 'Cached headline',
          publisher: {},
          published_utc: '2026-01-01T00:00:00Z',
          article_url: 'https://x.com',
        },
      ],
    });
  });

  await fetchNewsForSymbol('CACH');
  const callsAfterFirst = calls;
  await fetchNewsForSymbol('CACH');
  assert.strictEqual(calls, callsAfterFirst, 'the second call must be served from cache, not refetched at all');
});

test('a successful Gemini summary is merged onto the article, but real provider sentiment wins over the AI guess', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
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
        {
          index: 1,
          summary: 'Two sentence AI summary.',
          sentiment: 'positive',
          impact: 'This may add volatility.',
          catalyst: 'earnings',
        },
      ]),
    });
  });

  const result = await fetchNewsForSymbol('ENRI');
  const article = result.articles[0];
  assert.strictEqual(article.summary, 'Two sentence AI summary.');
  assert.strictEqual(article.impact, 'This may add volatility.');
  assert.strictEqual(article.sentiment, 'negative', "Massive's real per-ticker sentiment must win over Gemini's guess");
  assert.strictEqual(
    article.url,
    'https://x.com/enriched',
    'the real source link must survive the enrichment merge unchanged'
  );
  assert.strictEqual(article.catalyst, 'earnings');
});

test('an article with no source link is dropped — never shown as "verified" with nowhere to verify it', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
    if (url.includes('massive.com')) {
      return jsonResponse({
        results: [
          { title: 'No link here', publisher: {}, published_utc: '2026-01-01T00:00:00Z', article_url: '' },
          {
            title: 'Has a real link',
            publisher: {},
            published_utc: '2026-01-01T00:00:00Z',
            article_url: 'https://x.com/real',
          },
        ],
      });
    }
    return jsonResponse({ output_text: 'not valid json' });
  });

  const result = await fetchNewsForSymbol('NOLINK');
  assert.strictEqual(result.articles.length, 1);
  assert.strictEqual(result.articles[0].headline, 'Has a real link');
  assert.strictEqual(result.articles[0].url, 'https://x.com/real');
});

test('summarizer failure leaves the raw article untouched — no summary field appears', async () => {
  global.fetch = withHeadPassthrough(async (url) => {
    if (url.includes('massive.com')) {
      return jsonResponse({
        results: [
          {
            title: 'Unenriched headline',
            publisher: {},
            published_utc: '2026-01-01T00:00:00Z',
            article_url: 'https://x.com',
          },
        ],
      });
    }
    return jsonResponse({ output_text: 'not valid json' });
  });

  const result = await fetchNewsForSymbol('RAWW');
  assert.strictEqual(result.articles[0].summary, undefined);
  assert.strictEqual(result.articles[0].headline, 'Unenriched headline');
});

// Regression for a real user-reported bug: clicking "Full article" sometimes
// opened a site with nothing to do with the publisher name shown on screen
// (e.g. labeled "Yahoo", landed somewhere else entirely) — a provider's own
// "source" field can name one publisher while the link it hands back is a
// redirect/tracking wrapper that actually resolves elsewhere. The fix is to
// never trust that label: derive what's displayed from the domain the link
// actually resolves to, so the two can never disagree.
test('the displayed source is derived from where the article actually resolves to, never trusted blindly from the provider label', async () => {
  global.fetch = async (url, options) => {
    if (options && options.method === 'HEAD') {
      // The provider's link is a redirect wrapper that actually lands on Reuters.
      return { ok: true, url: 'https://www.reuters.com/markets/real-article' };
    }
    if (url.includes('massive.com')) {
      return jsonResponse({
        results: [
          {
            title: 'Ticker moves on report',
            publisher: { name: 'Yahoo Finance' }, // the provider's own (wrong) label
            published_utc: '2026-01-01T00:00:00Z',
            article_url: 'https://track.example.com/redirect?x=1',
          },
        ],
      });
    }
    return jsonResponse({ output_text: 'not valid json' });
  };

  const result = await fetchNewsForSymbol('MISLB');
  const article = result.articles[0];
  assert.strictEqual(
    article.url,
    'https://www.reuters.com/markets/real-article',
    'the stored url must be the real resolved destination, not the redirect wrapper'
  );
  assert.strictEqual(
    article.source,
    'Reuters',
    "the displayed source must match where the link actually goes, not the provider's claimed label"
  );
  assert.notStrictEqual(
    article.source,
    'Yahoo Finance',
    'must never show a publisher name that disagrees with the real destination'
  );
});

test('falls back to the provider-supplied source label only if the resolved domain has no known clean name, still never inventing anything', async () => {
  global.fetch = async (url, options) => {
    if (options && options.method === 'HEAD') {
      return { ok: true, url: 'https://some-obscure-wire-service-xyz.example/a' };
    }
    if (url.includes('massive.com')) {
      return jsonResponse({
        results: [
          {
            title: 'Small-cap wire report',
            publisher: { name: 'Obscure Wire' },
            published_utc: '2026-01-01T00:00:00Z',
            article_url: 'https://track.example.com/redirect?x=2',
          },
        ],
      });
    }
    return jsonResponse({ output_text: 'not valid json' });
  };

  const result = await fetchNewsForSymbol('OBSCR');
  // Still domain-derived (title-cased from the real host), not the
  // provider's claimed name — consistency with the real destination always
  // wins, even for a domain with no special-cased friendly name.
  assert.strictEqual(result.articles[0].source, 'Some Obscure Wire Service Xyz');
});
