const { finnhubFetch } = require('./finnhub');
const { summarizeArticles } = require('./newsSummarizer');
const { MASSIVE_API_KEY, MARKETAUX_API_KEY, NEWSDATA_API_KEY } = require('../config');

const newsCache = new Map();
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;

// Every provider below returns null on any failure (bad response, network
// error, missing key, empty result) — never throws. That lets
// fetchNewsForSymbol try them in order and only report "no verified news
// found" once every real source has been checked, never fabricated content.

async function fetchFromFinnhub(symbol) {
  try {
    var today = new Date();
    var twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    var url =
      'https://finnhub.io/api/v1/company-news?symbol=' +
      encodeURIComponent(symbol) +
      '&from=' +
      twoDaysAgo.toISOString().slice(0, 10) +
      '&to=' +
      today.toISOString().slice(0, 10);

    var res = await finnhubFetch(url);
    if (!res || !res.ok) return null;
    var data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data.slice(0, 8).map(function (a) {
      return {
        headline: a.headline || '',
        description: a.summary || '',
        source: a.source || '',
        datetime: a.datetime || 0,
        url: a.url || '',
        image: a.image || '',
        sentiment: null, // Finnhub's company-news endpoint doesn't include sentiment
      };
    });
  } catch (e) {
    return null;
  }
}

async function fetchFromMassive(symbol) {
  if (!MASSIVE_API_KEY) return null;
  try {
    var url =
      'https://api.massive.com/v2/reference/news?ticker=' +
      encodeURIComponent(symbol) +
      '&limit=8&apiKey=' +
      MASSIVE_API_KEY;
    var res = await fetch(url);
    if (!res.ok) return null;
    var data = await res.json();
    if (!Array.isArray(data.results) || data.results.length === 0) return null;

    return data.results.map(function (a) {
      // insights[] carries per-ticker sentiment when Massive has scored the
      // article — real provider data, preferred over an AI-guessed label.
      var insight =
        Array.isArray(a.insights) && a.insights.length > 0
          ? a.insights.find(function (ins) { return ins.ticker === symbol; }) || a.insights[0]
          : null;
      return {
        headline: a.title || '',
        description: a.description || '',
        source: (a.publisher && a.publisher.name) || '',
        datetime: a.published_utc ? Math.floor(new Date(a.published_utc).getTime() / 1000) : 0,
        url: a.article_url || '',
        image: a.image_url || '',
        sentiment: insight ? insight.sentiment || null : null,
      };
    });
  } catch (e) {
    return null;
  }
}

async function fetchFromMarketaux(symbol) {
  if (!MARKETAUX_API_KEY) return null;
  try {
    var url =
      'https://api.marketaux.com/v1/news/all?symbols=' +
      encodeURIComponent(symbol) +
      '&language=en&limit=8&api_token=' +
      MARKETAUX_API_KEY;
    var res = await fetch(url);
    if (!res.ok) return null;
    var data = await res.json();
    if (!Array.isArray(data.data) || data.data.length === 0) return null;

    return data.data.map(function (a) {
      return {
        headline: a.title || '',
        description: a.description || a.snippet || '',
        source: a.source || '',
        datetime: a.published_at ? Math.floor(new Date(a.published_at).getTime() / 1000) : 0,
        url: a.url || '',
        image: a.image_url || '',
        sentiment: a.sentiment || null,
      };
    });
  } catch (e) {
    return null;
  }
}

async function fetchFromNewsdata(symbol) {
  if (!NEWSDATA_API_KEY) return null;
  try {
    var url =
      'https://newsdata.io/api/1/latest?apikey=' +
      NEWSDATA_API_KEY +
      '&q=' +
      encodeURIComponent(symbol) +
      '&language=en';
    var res = await fetch(url);
    if (!res.ok) return null;
    var data = await res.json();
    if (!Array.isArray(data.results) || data.results.length === 0) return null;

    return data.results.slice(0, 8).map(function (a) {
      return {
        headline: a.title || '',
        description: a.description || '',
        source: a.source_id || a.source_name || '',
        datetime: a.pubDate ? Math.floor(new Date(a.pubDate).getTime() / 1000) : 0,
        url: a.link || '',
        image: a.image_url || '',
        sentiment: a.sentiment || null,
      };
    });
  } catch (e) {
    return null;
  }
}

async function fetchNewsForSymbol(symbol) {
  var cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.fetchTime < NEWS_CACHE_TTL_MS) {
    return { articles: cached.articles, fetchTime: cached.fetchTime, source: cached.source };
  }

  var providers = [
    { name: 'finnhub', fn: fetchFromFinnhub },
    { name: 'massive', fn: fetchFromMassive },
    { name: 'marketaux', fn: fetchFromMarketaux },
    { name: 'newsdata', fn: fetchFromNewsdata },
  ];

  var articles = null;
  var source = null;
  for (var i = 0; i < providers.length; i++) {
    articles = await providers[i].fn(symbol);
    if (articles && articles.length > 0) {
      source = providers[i].name;
      break;
    }
  }

  // Enrich with a Gemini-generated summary/sentiment/impact per article,
  // strictly grounded in the real headline+description above — never
  // fabricated. A failure here is silent: articles keep their raw headline
  // and no summary is shown, rather than inventing one.
  if (articles && articles.length > 0) {
    var enrichment = await summarizeArticles(symbol, articles);
    if (enrichment) {
      articles = articles.map(function (a, i) {
        var e = enrichment[i + 1];
        if (!e) return a;
        return Object.assign({}, a, {
          summary: e.summary,
          impact: e.impact,
          sentiment: a.sentiment || e.sentiment, // real provider sentiment wins over the AI guess
        });
      });
    }
  }

  var fetchTime = Date.now();
  // Only cache real results — an empty/failed lookup should be retried on
  // the next request rather than remembered as "no news" for 5 minutes.
  if (articles && articles.length > 0) {
    newsCache.set(symbol, { articles: articles, fetchTime: fetchTime, source: source });
  }

  return { articles: articles || [], fetchTime: fetchTime, source: source };
}

module.exports = { newsCache, NEWS_CACHE_TTL_MS, fetchNewsForSymbol };
