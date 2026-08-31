const router = require('express').Router();
const { getHistoricalVolumeContext } = require('../services/volumeContext');
const { scanLimiter } = require('../middleware/rateLimiters');
const { requireAuth } = require('../middleware/authMiddleware');
const { reportError } = require('../utils/reportError');

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;
var RATIO_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

router.get('/volume-context/:symbol', requireAuth, scanLimiter, async function (req, res) {
  var symbol = (req.params.symbol || '').toUpperCase();
  var ratioRaw = req.query.ratio;
  var ratio = typeof ratioRaw === 'string' && RATIO_RE.test(ratioRaw) ? Number(ratioRaw) : NaN;
  if (!SYMBOL_RE.test(symbol) || !Number.isFinite(ratio) || ratio <= 0) {
    return res.status(400).json({ error: 'symbol and valid ratio query param required' });
  }
  try {
    var context = await getHistoricalVolumeContext(symbol, ratio);
    if (!context) {
      return res.json({ found: false, context: null });
    }
    return res.json({ found: true, context: context });
  } catch (err) {
    reportError(err, '[volume-context]');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
