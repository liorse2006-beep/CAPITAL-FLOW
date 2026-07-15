const router = require('express').Router();
const { requirePremium } = require('../middleware/authMiddleware');
const { scanPreMarket } = require('../services/scanner');
const { premarketState } = require('../state');
const { ALL_TICKERS } = require('../../tickers');

router.get('/scan-premarket', requirePremium, async (req, res) => {
  if (premarketState.running) {
    return res.status(409).json({ error: 'Pre-market scan already in progress' });
  }

  premarketState.running = true;
  premarketState.progress = { processed: 0, total: ALL_TICKERS.length, found: 0 };

  try {
    const { results, errors, processed } = await scanPreMarket(ALL_TICKERS, {
      onProgress: (p) => {
        premarketState.progress = p;
      },
    });

    premarketState.running = false;

    res.json({
      results,
      scanTime: new Date().toISOString(),
      tickersScanned: processed,
      errors: errors.length,
    });
  } catch (err) {
    premarketState.running = false;
    console.error('[premarket]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/premarket-progress', requirePremium, (req, res) => {
  res.json({
    running: premarketState.running,
    progress: premarketState.progress,
  });
});

module.exports = router;
