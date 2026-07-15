const router = require('express').Router();
const { getHistoricalVolumeContext } = require('../services/volumeContext');
const { scanLimiter } = require('../middleware/rateLimiters');

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

router.get('/volume-context/:symbol', scanLimiter, async function (req, res) {
  var symbol = (req.params.symbol || '').toUpperCase();
  var ratio = parseFloat(req.query.ratio);
  if (!SYMBOL_RE.test(symbol) || isNaN(ratio) || ratio <= 0) {
    return res.status(400).json({ error: 'symbol and valid ratio query param required' });
  }
  try {
    var context = await getHistoricalVolumeContext(symbol, ratio);
    if (!context) {
      return res.json({ found: false, context: null });
    }
    return res.json({ found: true, context: context });
  } catch (err) {
    console.error('[volume-context]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
