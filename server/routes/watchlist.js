const router = require('express').Router();
const { quickScan } = require('../services/scanner');
const { scanLimiter } = require('../middleware/rateLimiters');

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

router.get('/watchlist-quotes', scanLimiter, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
