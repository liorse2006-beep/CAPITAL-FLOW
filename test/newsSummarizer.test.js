// Gemini-backed article summarizer (server/services/newsSummarizer.js).
// The core guarantee under test: it never invents content — a malformed
// or unparsable model response just means no enrichment, not a fabricated
// summary standing in for real data.
require('./helpers/testEnv');
const { test, after } = require('node:test');
const assert = require('node:assert');

process.env.GOOGLE_AI_STUDIO_KEY = 'test-gemini-key';
delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/newsSummarizer')];

const { summarizeArticles } = require('../server/services/newsSummarizer');

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
});

const ARTICLES = [
  { headline: 'Company X beats earnings', description: 'Revenue up 12% year over year.' },
  { headline: 'Company X faces lawsuit', description: '' },
];

test('parses a well-formed JSON array response into a 1-indexed map', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify([
        { index: 1, summary: 'Revenue rose 12% YoY. The company beat estimates.', sentiment: 'positive', impact: 'This may support short-term buying interest.' },
        { index: 2, summary: 'The company is facing a lawsuit.', sentiment: 'negative', impact: 'This could add short-term volatility.' },
      ]),
    }),
  });

  const result = await summarizeArticles('X', ARTICLES);
  assert.strictEqual(result[1].sentiment, 'positive');
  assert.match(result[1].summary, /12%/);
  assert.strictEqual(result[2].sentiment, 'negative');
});

test('extracts the JSON array even when the model wraps it in prose', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: 'Sure, here you go:\n[{"index": 1, "summary": "Ok.", "sentiment": "neutral", "impact": "May have limited effect."}]\nHope that helps!',
    }),
  });

  const result = await summarizeArticles('X', ARTICLES);
  assert.strictEqual(result[1].summary, 'Ok.');
});

test('an invalid sentiment value from the model is dropped rather than trusted verbatim', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify([{ index: 1, summary: 'Fine.', sentiment: 'super-bullish!!', impact: 'x' }]),
    }),
  });

  const result = await summarizeArticles('X', ARTICLES);
  assert.strictEqual(result[1].sentiment, null);
});

test('unparsable model output returns null — never a fabricated summary', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ output_text: 'not json at all' }) });
  const result = await summarizeArticles('X', ARTICLES);
  assert.strictEqual(result, null);
});

test('an HTTP error from the API returns null', async () => {
  global.fetch = async () => ({ ok: false, json: async () => ({ error: 'quota exceeded' }) });
  const result = await summarizeArticles('X', ARTICLES);
  assert.strictEqual(result, null);
});

test('an empty article list is a no-op, never calls the API', async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  };
  const result = await summarizeArticles('X', []);
  assert.strictEqual(result, null);
  assert.strictEqual(called, false);
});
