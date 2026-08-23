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
      const clientReferencePrice = Number(req.body.referencePrice);
      if (
        !Number.isFinite(targetPrice) ||
        targetPrice <= 0 ||
        targetPrice > MAX_PRICE ||
        !Number.isFinite(clientReferencePrice) ||
        clientReferencePrice <= 0 ||
        clientReferencePrice > MAX_PRICE
      )
        return res.status(400).json({ error: 'targetPrice and referencePrice (> 0) required' });

      // Which side of targetPrice the stock is on right now decides whether
      // the background checker later sees a real crossing or fires
      // immediately. That decision must not rest on a number the client
      // supplied and could be stale (the UI's own quote cache can be several
      // minutes old) or simply wrong — re-fetch a live quote here and use
      // IT as the authority. clientReferencePrice is only a fallback for the
      // rare case the live fetch itself fails, so the alert can still be
      // created instead of hard-failing the request.
      let referencePrice = clientReferencePrice;
      try {
        const quotes = await quoteCache.getQuotes([symbol]);
        const live = quotes.get(symbol);
        if (live && live.regularMarketPrice > 0) referencePrice = live.regularMarketPrice;
      } catch (_) {
        // Live fetch failed — fall back to the client-supplied price rather
        // than blocking the user from setting an alert at all.
      }

      const startingSide = referencePrice >= targetPrice ? 'above' : 'below';
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
