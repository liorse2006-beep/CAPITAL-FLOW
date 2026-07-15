const router = require('express').Router();
const { newsCache, NEWS_CACHE_TTL_MS, fetchNewsForSymbol } = require('../services/newsService');
const { scanLimiter } = require('../middleware/rateLimiters');

// Real ticker symbols only — letters, digits, and . or - for share classes
// (e.g. BRK.B). Blocks malformed/oversized input before it reaches the
// external news API.
var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

router.get('/news/:symbol', scanLimiter, async function (req, res) {
  var symbol = (req.params.symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

  var cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.fetchTime < NEWS_CACHE_TTL_MS) {
    return res.json({
      symbol: symbol,
      articles: cached.articles,
      fetchTime: new Date(cached.fetchTime).toISOString(),
      fromCache: true,
    });
  }

  try {
    var result = await fetchNewsForSymbol(symbol);
    return res.json({
      symbol: symbol,
      articles: result.articles,
      fetchTime: new Date(result.fetchTime).toISOString(),
    });
  } catch (err) {
    console.error('[news]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
