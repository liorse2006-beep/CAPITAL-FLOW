const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const {
  getWatchlistAlerts,
  setAlert,
  removeAlert,
  clearAlerts,
  SYMBOL_RE,
  MAX_VOLUME_RATIO,
  MAX_PRICE,
} = require('../services/watchlistAlerts');
const quoteCache = require('../services/quoteCache');
const { reportError } = require('../utils/reportError');

router.get('/watchlist-alerts', requireEliteOrTrial, async (req, res) => {
  try {
    res.json(await getWatchlistAlerts(req.user.id));
  } catch (err) {
    reportError(err, '[watchlist-alerts GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/watchlist-alerts/:symbol', requireEliteOrTrial, async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase();
    const type = req.body.type === 'price' ? 'price' : 'volume';
    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

    if (type === 'price') {
      const targetPrice = Number(req.body.targetPrice);
      if (!Number.isFinite(targetPrice) || targetPrice <= 0 || targetPrice > MAX_PRICE)
        return res.status(400).json({ error: 'targetPrice (> 0) is required' });

      // Which side of targetPrice the stock is on right now decides whether
      // the background checker later sees a real crossing or fires
      // immediately. That decision must not rest on a number the client
      // supplied and could be stale (the UI's own quote cache can be several
      // minutes old) or simply wrong. A client referencePrice may still be
      // sent by older app builds for compatibility, but it is deliberately
      // ignored. If the server cannot verify a current price, do not create
      // an alert whose starting side would be a guess.
      let quotes;
      try {
        quotes = await quoteCache.getQuotes([symbol]);
      } catch (_) {
        return res.status(503).json({
          code: 'DATA_UNAVAILABLE',
          error: 'Current price data is unavailable right now. Try again in a few minutes.',
        });
      }

      const live = quotes && typeof quotes.get === 'function' ? quotes.get(symbol) : null;
      const staleSymbols = new Set(
        Array.isArray(quotes && quotes.staleSymbols)
          ? quotes.staleSymbols.map((value) =>
              String(value || '')
                .trim()
                .toUpperCase()
            )
          : []
      );
      const currentPrice = Number(live && live.regularMarketPrice);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0 || staleSymbols.has(symbol)) {
        return res.status(503).json({
          code: 'DATA_UNAVAILABLE',
          error: 'Current price data is unavailable right now. Try again in a few minutes.',
        });
      }

      const startingSide = currentPrice >= targetPrice ? 'above' : 'below';
      await setAlert(req.user.id, symbol, { type: 'price', targetPrice, startingSide });
      return res.json({ ok: true, symbol, type, targetPrice, startingSide });
    }

    const minRatio = Number(req.body.minRatio);
    if (!Number.isFinite(minRatio) || minRatio <= 0 || minRatio > MAX_VOLUME_RATIO)
      return res.status(400).json({ error: 'minRatio must be finite and within the supported range' });
    await setAlert(req.user.id, symbol, { type: 'volume', minRatio });
    res.json({ ok: true, symbol, type, minRatio });
  } catch (err) {
    if (err && (err.code === 'ALERT_LIMIT' || err.code === 'INVALID_ALERT')) {
      return res.status(400).json({ error: err.message });
    }
    reportError(err, '[watchlist-alerts POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist-alerts/:symbol', requireEliteOrTrial, async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    await removeAlert(req.user.id, symbol);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[watchlist-alerts DELETE symbol]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist-alerts', requireEliteOrTrial, async (req, res) => {
  try {
    await clearAlerts(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[watchlist-alerts DELETE all]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
