const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const { getWatchlistAlerts, setAlert, removeAlert, clearAlerts } = require('../services/watchlistAlerts');

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
      const referencePrice = parseFloat(req.body.referencePrice);
      if (isNaN(targetPrice) || targetPrice <= 0 || isNaN(referencePrice) || referencePrice <= 0)
        return res.status(400).json({ error: 'targetPrice and referencePrice (> 0) required' });
      // referencePrice is just the live price the client had on screen when
      // the alert was set — used once, here, to record which side of
      // targetPrice the stock started on so the background checker can
      // detect an actual crossing later rather than firing immediately
      // because the price already happens to be past the target.
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
