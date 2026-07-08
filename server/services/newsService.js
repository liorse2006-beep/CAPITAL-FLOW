const { finnhubFetch } = require('./finnhub');

const newsCache = new Map();
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchNewsForSymbol(symbol) {
  var cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.fetchTime < NEWS_CACHE_TTL_MS) {
    return { articles: cached.articles, fetchTime: cached.fetchTime };
  }

  var today = new Date();
  var yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  var toDate = today.toISOString().slice(0, 10);
  var fromDate = yesterday.toISOString().slice(0, 10);
  var url = 'https://finnhub.io/api/v1/company-news?symbol=' + encodeURIComponent(symbol) +
    '&from=' + fromDate + '&to=' + toDate;

  var newsRes = await finnhubFetch(url);
  if (!newsRes) return { articles: [], fetchTime: Date.now() };
  var newsData = await newsRes.json();
  var articles = Array.isArray(newsData) ? newsData.slice(0, 8).map(function(a) {
    return {
      headline: a.headline || '',
      source: a.source || '',
      datetime: a.datetime || 0,
      url: a.url || '',
      image: a.image || '',
    };
  }) : [];

  var fetchTime = Date.now();
  newsCache.set(symbol, { articles: articles, fetchTime: fetchTime });
  return { articles: articles, fetchTime: fetchTime };
}

module.exports = { newsCache, NEWS_CACHE_TTL_MS, fetchNewsForSymbol };
