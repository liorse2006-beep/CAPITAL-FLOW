const router = require('express').Router();
const { fetchNewsForSymbol } = require('../services/newsService');
const { scanLimiter } = require('../middleware/rateLimiters');
const { requireEliteOrTrial } = require('../middleware/authMiddleware');

// Real ticker symbols only — letters, digits, and . or - for share classes
// (e.g. BRK.B). Blocks malformed/oversized input before it reaches the
// external news API.
var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

router.get('/news/:symbol', requireEliteOrTrial, scanLimiter, async function (req, res) {
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
    console.error('[news]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
