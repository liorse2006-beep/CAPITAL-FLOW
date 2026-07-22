const router = require('express').Router();
const { quickScan } = require('../services/scanner');
const { scanLimiter } = require('../middleware/rateLimiters');
const { requireAuth } = require('../middleware/authMiddleware');
const { getWatchlist, addToWatchlist, removeFromWatchlist } = require('../services/watchlist');

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;
var MAX_WATCHLIST_SIZE = 50; // matches the /watchlist-quotes cap below

router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    res.json(await getWatchlist(req.user.id));
  } catch (err) {
    console.error('[watchlist GET]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/watchlist/:symbol', requireAuth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    const current = await getWatchlist(req.user.id);
    if (current.length >= MAX_WATCHLIST_SIZE && current.indexOf(symbol) === -1) {
      return res.status(400).json({ error: 'Watchlist is full (max ' + MAX_WATCHLIST_SIZE + ' tickers)' });
    }
    await addToWatchlist(req.user.id, symbol);
    res.json({ ok: true, symbol });
  } catch (err) {
    console.error('[watchlist POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist/:symbol', requireAuth, async (req, res) => {
  try {
    await removeFromWatchlist(req.user.id, req.params.symbol.toUpperCase());
    res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist DELETE]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/watchlist-quotes', requireAuth, scanLimiter, async (req, res) => {
  var symbols = req.query.symbols
    ? req.query.symbols
        .split(',')
        .map(function (s) {
          return s.trim().toUpperCase();
        })
        .filter(function (s) {
          return SYMBOL_RE.test(s);
        })
    : [];
  if (symbols.length === 0) return res.json({ results: [] });
  if (symbols.length > 50) symbols = symbols.slice(0, 50);
  try {
    var results = await quickScan(symbols);
    res.json({ results: results, fetchTime: new Date().toISOString() });
  } catch (err) {
    console.error('[watchlist-quotes]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
