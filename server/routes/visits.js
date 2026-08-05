const router = require('express').Router();
const { recordVisit } = require('../services/siteVisits');
const { publicWriteLimiter } = require('../middleware/rateLimiters');
const { reportError } = require('../utils/reportError');

// Public, unauthenticated, fire-and-forget. The frontend calls this once per
// browser session (guarded by sessionStorage) so it counts "people who opened
// the site", not every reload. Always answers 200 — a counter write failing
// must never surface as an error to the visitor.
router.post('/visit', publicWriteLimiter, async (req, res) => {
  try {
    await recordVisit();
  } catch (err) {
    reportError(err, '[visit]');
  }
  res.json({ ok: true });
});

module.exports = router;
