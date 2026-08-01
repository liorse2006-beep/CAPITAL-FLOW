const router = require('express').Router();
const { recordVisit } = require('../services/siteVisits');

// Public, unauthenticated, fire-and-forget. The frontend calls this once per
// browser session (guarded by sessionStorage) so it counts "people who opened
// the site", not every reload. Always answers 200 — a counter write failing
// must never surface as an error to the visitor.
router.post('/visit', async (req, res) => {
  try {
    await recordVisit();
  } catch (err) {
    console.error('[visit]', err.message);
  }
  res.json({ ok: true });
});

module.exports = router;
