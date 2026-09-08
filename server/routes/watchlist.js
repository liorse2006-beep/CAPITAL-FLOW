const router = require('express').Router();
const { quickScan } = require('../services/scanner');
const { scanLimiter } = require('../middleware/rateLimiters');
const { requireAuth } = require('../middleware/authMiddleware');
const { getWatchlist, addToWatchlist, removeFromWatchlist, MAX_WATCHLIST_SIZE } = require('../services/watchlist');
const { reportError } = require('../utils/reportError');
const { buildFinancialProvenance, CAPITAL_FLOW_SOURCES } = require('../services/financialProvenance');

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    res.json(await getWatchlist(req.user.id));
  } catch (err) {
    reportError(err, '[watchlist GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/watchlist/:symbol', requireAuth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    await addToWatchlist(req.user.id, symbol);
    res.json({ ok: true, symbol });
  } catch (err) {
    if (err && err.code === 'WATCHLIST_LIMIT') {
      return res.status(400).json({ error: `Watchlist is full (max ${MAX_WATCHLIST_SIZE} tickers)` });
    }
    reportError(err, '[watchlist POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist/:symbol', requireAuth, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    await removeFromWatchlist(req.user.id, symbol);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[watchlist DELETE]');
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
    var scan = await quickScan(symbols, { withMetadata: true });
    var fetchTime = new Date().toISOString();
    res.json({
      results: scan.results,
      fetchTime: fetchTime,
      dataStatus: scan.dataStatus,
      quoteDataStatus: scan.quoteDataStatus,
      staleCount: scan.staleCount,
      dataAsOf: scan.dataAsOf,
      dataProvenance: buildFinancialProvenance({
        dataAsOf: scan.dataAsOf,
        capturedAt: fetchTime,
        status: scan.dataStatus,
        quoteStatus: scan.quoteDataStatus,
        sources: CAPITAL_FLOW_SOURCES.map((source) => ({
          ...source,
          asOf: source.role === 'quote baseline' ? scan.dataAsOf : null,
          status: source.role === 'quote baseline' ? scan.quoteDataStatus : 'unknown',
        })),
      }),
    });
  } catch (err) {
    reportError(err, '[watchlist-quotes]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
