const router = require('express').Router();
const { requireElite } = require('../middleware/authMiddleware');
const { getWatchlistAlerts, setAlert, removeAlert, clearAlerts } = require('../services/watchlistAlerts');

router.get('/watchlist-alerts', requireElite, (req, res) => res.json(getWatchlistAlerts(req.user.id)));
router.post('/watchlist-alerts/:symbol', requireElite, (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const minRatio = parseFloat(req.body.minRatio);
  if (!symbol || isNaN(minRatio) || minRatio <= 0)
    return res.status(400).json({ error: 'symbol and minRatio (> 0) required' });
  setAlert(req.user.id, symbol, minRatio);
  res.json({ ok: true, symbol, minRatio });
});
router.delete('/watchlist-alerts/:symbol', requireElite, (req, res) => {
  removeAlert(req.user.id, req.params.symbol.toUpperCase());
  res.json({ ok: true });
});
router.delete('/watchlist-alerts', requireElite, (req, res) => {
  clearAlerts(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
