const router = require('express').Router();
const { requireElite } = require('../middleware/authMiddleware');
const { getWatchlistAlerts, setAlert, removeAlert, clearAlerts } = require('../services/watchlistAlerts');

router.get('/watchlist-alerts', requireElite, async (req, res) => {
  try {
    res.json(await getWatchlistAlerts(req.user.id));
  } catch (err) {
    console.error('[watchlist-alerts GET]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/watchlist-alerts/:symbol', requireElite, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const minRatio = parseFloat(req.body.minRatio);
    if (!symbol || isNaN(minRatio) || minRatio <= 0)
      return res.status(400).json({ error: 'symbol and minRatio (> 0) required' });
    await setAlert(req.user.id, symbol, minRatio);
    res.json({ ok: true, symbol, minRatio });
  } catch (err) {
    console.error('[watchlist-alerts POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist-alerts/:symbol', requireElite, async (req, res) => {
  try {
    await removeAlert(req.user.id, req.params.symbol.toUpperCase());
    res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist-alerts DELETE symbol]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist-alerts', requireElite, async (req, res) => {
  try {
    await clearAlerts(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist-alerts DELETE all]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
