const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const { getWatchlistAlerts, setAlert, removeAlert, clearAlerts } = require('../services/watchlistAlerts');
const quoteCache = require('../services/quoteCache');

router.get('/watchlist-alerts', requireEliteOrTrial, async (req, res) => {
  try {
    res.json(await getWatchlistAlerts(req.user.id));
  } catch (err) {
    console.error('[watchlist-alerts GET]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/watchlist-alerts/:symbol', requireEliteOrTrial, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const type = req.body.type === 'price' ? 'price' : 'volume';
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    if (type === 'price') {
      const targetPrice = parseFloat(req.body.targetPrice);
      const clientReferencePrice = parseFloat(req.body.referencePrice);
      if (isNaN(targetPrice) || targetPrice <= 0 || isNaN(clientReferencePrice) || clientReferencePrice <= 0)
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

    const minRatio = parseFloat(req.body.minRatio);
    if (isNaN(minRatio) || minRatio <= 0) return res.status(400).json({ error: 'minRatio (> 0) required' });
    await setAlert(req.user.id, symbol, { type: 'volume', minRatio });
    res.json({ ok: true, symbol, type, minRatio });
  } catch (err) {
    console.error('[watchlist-alerts POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist-alerts/:symbol', requireEliteOrTrial, async (req, res) => {
  try {
    await removeAlert(req.user.id, req.params.symbol.toUpperCase());
    res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist-alerts DELETE symbol]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist-alerts', requireEliteOrTrial, async (req, res) => {
  try {
    await clearAlerts(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist-alerts DELETE all]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
