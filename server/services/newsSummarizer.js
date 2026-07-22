// Turns raw news articles into a 2-sentence summary + sentiment + a hedged
// short-term-impact note per article, using Gemini. Strictly grounded: the
// prompt forbids adding any fact not present in the headline/description we
// hand it, so a thin or empty description degrades to a plain paraphrase of
// the headline rather than inventing detail. Never throws — a failure here
// just means the caller shows the raw article instead of the enrichment,
// never an invented one.

const { GOOGLE_AI_STUDIO_KEY } = require('../config');

const MODEL = 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

// Shares the app-wide free Gemini quota with Capi (services/chatbot.js) —
// kept modest since this fires per news-scan click, batched one call per
// symbol rather than one per article.
const DAILY_CALL_CAP = 300;
let callCount = 0;
let callCountDate = null;

function withinDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (callCountDate !== today) {
    callCountDate = today;
    callCount = 0;
  }
  return callCount < DAILY_CALL_CAP;
}

const SYSTEM_PROMPT = `You are a financial-news summarizer for Capital Flow, a stock volume-scanner app. You will get a stock ticker and a numbered list of real news articles (headline + description) about it.

For EACH article, produce:
- "summary": exactly two plain sentences summarizing ONLY what the provided headline and description actually say. Never add a fact, number, date, or event that is not present in the text given to you. If the description is empty or too thin to summarize, write one neutral sentence paraphrasing the headline only — do not invent supporting detail.
- "sentiment": one of "positive", "negative", or "neutral", based strictly on the tone of the given text.
- "impact": one short sentence of general, hedged, informational commentary (never advice, never a price prediction, never "will") about how this kind of news can typically affect short-term trading activity or volatility for a stock. Always use "may" or "could", never "will".

Respond with ONLY a JSON array, no prose before or after, in exactly this shape:
[{"index": 1, "summary": "...", "sentiment": "neutral", "impact": "..."}]`;

function extractText(data) {
  if (data.output_text) return data.output_text;
  if (!Array.isArray(data.steps)) return null;
  for (const step of data.steps) {
    if (step.type === 'model_output' && Array.isArray(step.content)) {
      for (const part of step.content) {
        if (part.type === 'text' && part.text) return part.text;
      }
    }
  }
  return null;
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

/** Returns { [1-based index]: { summary, sentiment, impact } } or null on any failure. */
async function summarizeArticles(symbol, articles) {
  if (!GOOGLE_AI_STUDIO_KEY) return null;
  if (!Array.isArray(articles) || articles.length === 0) return null;
  if (!withinDailyCap()) return null;

  const input =
    'Ticker: ' +
    symbol +
    '\n\n' +
    articles
      .map(function (a, i) {
        return (i + 1) + '. Headline: ' + a.headline + '\nDescription: ' + (a.description || '(none provided)');
      })
      .join('\n\n');

  try {
    callCount++;
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GOOGLE_AI_STUDIO_KEY,
        'Content-Type': 'application/json',
        'Api-Revision': API_REVISION,
      },
      body: JSON.stringify({ model: MODEL, input, system_instruction: SYSTEM_PROMPT }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const text = extractText(data);
    if (!text) return null;

    const jsonText = extractJsonArray(text);
    if (!jsonText) return null;

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return null;

    const byIndex = {};
    parsed.forEach(function (item) {
      if (item && typeof item.index === 'number' && typeof item.summary === 'string') {
        byIndex[item.index] = {
          summary: item.summary,
          sentiment: ['positive', 'negative', 'neutral'].includes(item.sentiment) ? item.sentiment : null,
          impact: typeof item.impact === 'string' ? item.impact : null,
        };
      }
    });
    return byIndex;
  } catch (e) {
    return null;
  }
}

module.exports = { summarizeArticles };
