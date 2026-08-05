const router = require('express').Router();
const { fetchNewsForSymbol, newsCache, resolveFinalUrl } = require('../services/newsService');
const { scanLimiter } = require('../middleware/rateLimiters');
const { requireAuth } = require('../middleware/authMiddleware');
const { reportError } = require('../utils/reportError');

// Real ticker symbols only — letters, digits, and . or - for share classes
// (e.g. BRK.B). Blocks malformed/oversized input before it reaches the
// external news API.
var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

// News is available to every signed-in tier (Free/Premium/Elite alike) —
// unlike Capi or push, it isn't a paid-tier differentiator, just login-gated.
router.get('/news/:symbol', requireAuth, scanLimiter, async function (req, res) {
  var symbol = (req.params.symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

  try {
    var result = await fetchNewsForSymbol(symbol);
    return res.json({
      symbol: symbol,
      articles: result.articles,
      source: result.source,
      fetchTime: new Date(result.fetchTime).toISOString(),
    });
  } catch (err) {
    reportError(err, '[news]');
    return res.status(500).json({ error: 'Server error' });
  }
});

// Only ever resolves a URL we ourselves already returned for this exact
// symbol's cached articles — never an arbitrary caller-supplied URL, which
// would otherwise let this endpoint be used as an open server-side fetch
// proxy (SSRF) against anything reachable from the server.
router.get('/news/:symbol/resolve', requireAuth, scanLimiter, async function (req, res) {
  var symbol = (req.params.symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

  var targetUrl = req.query.url;
  if (typeof targetUrl !== 'string' || !targetUrl) return res.status(400).json({ error: 'Missing url' });

  var cached = newsCache.get(symbol);
  var known = cached && Array.isArray(cached.articles) && cached.articles.some(function (a) {
    return a.url === targetUrl;
  });
  if (!known) return res.status(400).json({ error: 'Unknown article URL' });

  return res.json({ url: await resolveFinalUrl(targetUrl) });
});

module.exports = router;
