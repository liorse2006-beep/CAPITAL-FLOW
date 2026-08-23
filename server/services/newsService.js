const { finnhubFetch } = require('./finnhub');
const { summarizeArticles } = require('./newsSummarizer');
const { MASSIVE_API_KEY, MARKETAUX_API_KEY, NEWSDATA_API_KEY } = require('../config');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');

const newsCache = new Map();
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const newsProbeCache = new Map();
const NEWS_PROBE_TTL_MS = 5 * 60 * 1000;

// Quality over quantity: a wall of 8 headlines nobody reads is worse than
// the 4 most recent from a single trustworthy provider — also keeps the
// per-symbol Gemini summarization call small and fast.
const MAX_ARTICLES = 4;

// Every provider below returns null on any failure (bad response, network
// error, missing key, empty result) — never throws. That lets
// fetchNewsForSymbol try them in order and only report "no verified news
// found" once every real source has been checked, never fabricated content.

async function fetchFromFinnhub(symbol) {
  try {
    var today = new Date();
    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    var url =
      'https://finnhub.io/api/v1/company-news?symbol=' +
      encodeURIComponent(symbol) +
      '&from=' +
      sevenDaysAgo.toISOString().slice(0, 10) +
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
    var res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    var data = await res.json();
    if (!Array.isArray(data.results) || data.results.length === 0) return null;

    return data.results.map(function (a) {
      // insights[] carries per-ticker sentiment when Massive has scored the
      // article — real provider data, preferred over an AI-guessed label.
      var insight =
        Array.isArray(a.insights) && a.insights.length > 0
          ? a.insights.find(function (ins) {
              return ins.ticker === symbol;
            }) || a.insights[0]
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
    var res = await fetchWithTimeout(url);
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

// NewsData.io's /latest is a generic full-text search (q=<ticker>), unlike
// the other three providers which are natively ticker-scoped (company-news,
// reference/news?ticker=, news/all?symbols=) and don't need this — a short
// ticker like "ALL" or "IT" can match plain English words in unrelated
// articles. Require the exact ticker to actually appear as a whole word in
// the headline or description before trusting a result from this provider.
function mentionsTicker(article, symbol) {
  var escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('\\b' + escaped + '\\b', 'i');
  return re.test(article.headline) || re.test(article.description || '');
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
    var res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    var data = await res.json();
    if (!Array.isArray(data.results) || data.results.length === 0) return null;

    return data.results
      .slice(0, 8)
      .map(function (a) {
        return {
          headline: a.title || '',
          description: a.description || '',
          source: a.source_id || a.source_name || '',
          datetime: a.pubDate ? Math.floor(new Date(a.pubDate).getTime() / 1000) : 0,
          url: a.link || '',
          image: a.image_url || '',
          sentiment: a.sentiment || null,
        };
      })
      .filter(function (a) {
        return mentionsTicker(a, symbol);
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
    // An article the user can't actually open isn't "verified news" —
    // drop anything a provider returned without a real source link before
    // it ever reaches a slot (or a Gemini summarization call).
    if (articles) {
      articles = articles.filter(function (a) {
        return !!a.url;
      });
    }
    if (articles && articles.length > 0) {
      source = providers[i].name;
      articles = articles.slice(0, MAX_ARTICLES);
      break;
    }
  }

  // Resolve every article's URL to where it actually lands, and derive the
  // displayed publisher name (a.source) from THAT domain — never from
  // whatever label the provider handed back. A provider's feed can name one
  // publisher while syndicating a link that lands somewhere else entirely
  // once redirects resolve; showing "Yahoo" and opening a different site is
  // a real trust problem, not a cosmetic one. Doing this once here (cached
  // for NEWS_CACHE_TTL_MS with everything else) means the label the user
  // sees and the page "Full article" actually opens can never disagree.
  if (articles && articles.length > 0) {
    articles = await Promise.all(
      articles.map(async function (a) {
        var resolvedUrl = await resolveFinalUrl(a.url);
        return Object.assign({}, a, {
          url: resolvedUrl,
          source: labelFromUrl(resolvedUrl) || a.source || '',
        });
      })
    );
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
          catalyst: e.catalyst,
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

// A status check must verify that at least one configured provider can return
// real, linkable news — not run the full user path (URL resolution and Gemini
// enrichment would be unnecessarily expensive every five minutes). Results
// are cached for one monitoring interval and never include provider keys.
async function probeNewsProviders(symbol) {
  const key = String(symbol || '')
    .trim()
    .toUpperCase();
  const cached = newsProbeCache.get(key);
  if (cached && Date.now() - cached.checkedAt < NEWS_PROBE_TTL_MS) return cached.result;

  const providers = [
    { name: 'finnhub', fn: fetchFromFinnhub },
    { name: 'massive', fn: fetchFromMassive },
    { name: 'marketaux', fn: fetchFromMarketaux },
    { name: 'newsdata', fn: fetchFromNewsdata },
  ];
  for (const provider of providers) {
    const articles = await provider.fn(key);
    const usable = Array.isArray(articles)
      ? articles.filter((article) => article && typeof article.url === 'string' && article.url)
      : [];
    if (usable.length) {
      const result = { ok: true, provider: provider.name, sample: { symbol: key, articleCount: usable.length } };
      newsProbeCache.set(key, { checkedAt: Date.now(), result });
      return result;
    }
  }
  const result = { ok: false, provider: null, sample: null };
  newsProbeCache.set(key, { checkedAt: Date.now(), result });
  return result;
}

// Blocks the server from ever HEAD-fetching a private/internal address.
// Today the only caller (routes/news.js) already restricts `url` to one this
// server itself returned from a real news provider, so this is defense in
// depth — not the only guard — for the case a provider's article URL ever
// points (accidentally or via a compromised feed) at localhost, a private
// LAN range, or a cloud metadata endpoint like 169.254.169.254.
var PRIVATE_HOSTNAME_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

function isDisallowedUrl(url) {
  try {
    var parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    var host = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    return PRIVATE_HOSTNAME_RE.test(host);
  } catch (e) {
    return true; // unparseable URL — never fetch it
  }
}

// Known aliases for publisher domains whose bare hostname would otherwise
// read oddly once title-cased generically below (e.g. "Finance.yahoo").
var KNOWN_SOURCE_LABELS = {
  'finance.yahoo': 'Yahoo Finance',
  yahoo: 'Yahoo',
  reuters: 'Reuters',
  cnbc: 'CNBC',
  bloomberg: 'Bloomberg',
  marketwatch: 'MarketWatch',
  seekingalpha: 'Seeking Alpha',
  fool: 'The Motley Fool',
  benzinga: 'Benzinga',
  investing: 'Investing.com',
  businesswire: 'Business Wire',
  prnewswire: 'PR Newswire',
  globenewswire: 'GlobeNewswire',
  barrons: "Barron's",
  wsj: 'The Wall Street Journal',
  apnews: 'Associated Press',
};

// Derives a human-readable publisher name from the domain a URL actually
// resolves to — used instead of trusting whatever "source" string a
// provider hands back. A provider's own source label can name one
// publisher while syndicating a link that actually lands somewhere else
// entirely once redirects resolve (Finnhub's aggregated feed does this) —
// showing "Yahoo" and then opening a completely different site is exactly
// the kind of mismatch that makes the whole feature look fabricated. The
// label is always derived from the same URL the user is actually sent to,
// so the two can never disagree.
function labelFromUrl(url) {
  try {
    var host = new URL(url).hostname.replace(/^www\./, '');
    var base = host.split('.').slice(0, -1).join('.') || host;
    if (KNOWN_SOURCE_LABELS[base]) return KNOWN_SOURCE_LABELS[base];
    return base
      .split(/[-.]/)
      .filter(Boolean)
      .map(function (p) {
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join(' ');
  } catch (e) {
    return null;
  }
}

// Some providers (Finnhub in particular) hand back a tracking/redirect link
// rather than the publisher's real URL, so opening it directly flashes the
// intermediate domain before landing on the article. HEAD-follows the
// redirect chain server-side and returns wherever it actually lands — never
// throws, falls back to the original url on any failure or timeout so a
// slow/broken destination never leaves the user stuck.
async function resolveFinalUrl(url) {
  if (isDisallowedUrl(url)) return url;
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function () {
      controller.abort();
    }, 5000);
    var res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    // The redirect chain itself could land on a private address even if the
    // starting url didn't — re-check before trusting res.url.
    return isDisallowedUrl(res.url) ? url : res.url || url;
  } catch (e) {
    return url;
  }
}

module.exports = {
  newsCache,
  newsProbeCache,
  NEWS_CACHE_TTL_MS,
  NEWS_PROBE_TTL_MS,
  fetchNewsForSymbol,
  probeNewsProviders,
  resolveFinalUrl,
};
