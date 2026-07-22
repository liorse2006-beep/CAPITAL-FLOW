const { finnhubFetch } = require('./finnhub');
const { MASSIVE_API_KEY, MARKETAUX_API_KEY } = require('../config');

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
        source: a.source || '',
        datetime: a.datetime || 0,
        url: a.url || '',
        image: a.image || '',
        sentiment: null,
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
      return {
        headline: a.title || '',
        source: (a.publisher && a.publisher.name) || '',
        datetime: a.published_utc ? Math.floor(new Date(a.published_utc).getTime() / 1000) : 0,
        url: a.article_url || '',
        image: a.image_url || '',
        sentiment: null,
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

async function fetchNewsForSymbol(symbol) {
  var cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.fetchTime < NEWS_CACHE_TTL_MS) {
    return { articles: cached.articles, fetchTime: cached.fetchTime, source: cached.source };
  }

  var providers = [
    { name: 'finnhub', fn: fetchFromFinnhub },
    { name: 'massive', fn: fetchFromMassive },
    { name: 'marketaux', fn: fetchFromMarketaux },
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

  var fetchTime = Date.now();
  // Only cache real results — an empty/failed lookup should be retried on
  // the next request rather than remembered as "no news" for 5 minutes.
  if (articles && articles.length > 0) {
    newsCache.set(symbol, { articles: articles, fetchTime: fetchTime, source: source });
  }

  return { articles: articles || [], fetchTime: fetchTime, source: source };
}

module.exports = { newsCache, NEWS_CACHE_TTL_MS, fetchNewsForSymbol };
