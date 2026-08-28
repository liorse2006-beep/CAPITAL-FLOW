const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const db = require('../db');
const { reportError } = require('../utils/reportError');
const {
  MAX_RADARS_PER_USER,
  MAX_ACTIVE_RADARS_PER_USER,
  RADAR_LIMIT_MESSAGE,
  RADAR_ACTIVE_LIMIT_MESSAGE,
  normalizeRadarInput,
  getRadarBundle,
  getRadarRowForUser,
  getEventRows,
  createRadar,
  updateRadar,
  deleteRadar,
  serializeRadar,
} = require('../services/radar');

function radarId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sendValidationError(res, error) {
  if (error && (error.code === 'RADAR_LIMIT_REACHED' || error.code === 'RADAR_ACTIVE_LIMIT_REACHED')) {
    return res.status(409).json({ code: error.code, error: error.message });
  }
  if (
    error &&
    (error.code === 'INVALID_RADAR' ||
      error.code === 'INVALID_RADAR_FILTERS' ||
      error.code === 'INVALID_RADAR_SCHEDULE')
  ) {
    return res.status(400).json({ error: error.message });
  }
  return null;
}

// GET /api/radars — only the authenticated owner's recipes and sanitized
// event payloads are returned. Provider errors, secrets, and stack traces do
// not cross this boundary.
router.get('/radars', requireEliteOrTrial, async (req, res) => {
  try {
    res.json({ radars: await getRadarBundle(req.user.id) });
  } catch (error) {
    reportError(error, '[radars GET]');
    res.status(500).json({ error: 'Data is not available right now. Try again in a few minutes.' });
  }
});

// POST /api/radars — a recipe is checked against the shared-scan floor at the
// server boundary so the worker never silently misses matches below its data.
router.post('/radars', requireEliteOrTrial, async (req, res) => {
  try {
    // Validate before checking the account limit so malformed requests always
    // receive a useful validation response.
    normalizeRadarInput(req.body || {});
    const count = await db
      .prepare('SELECT COUNT(*) AS count FROM capital_flow_radars WHERE user_id = ?')
      .get(req.user.id);
    if (Number(count && count.count) >= MAX_RADARS_PER_USER) {
      return res.status(409).json({ code: 'RADAR_LIMIT_REACHED', error: RADAR_LIMIT_MESSAGE });
    }

    const row = await createRadar(req.user.id, req.body || {});
    res.status(201).json({ radar: serializeRadar(row, []) });
  } catch (error) {
    if (sendValidationError(res, error)) return;
    reportError(error, '[radars POST]');
    res.status(500).json({ error: 'Radar could not be created right now.' });
  }
});

// PUT /api/radars/:id — update a saved recipe or pause/resume it.
router.put('/radars/:id', requireEliteOrTrial, async (req, res) => {
  const id = radarId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid Radar id.' });
  try {
    const existing = await getRadarRowForUser(req.user.id, id);
    if (!existing) return res.status(404).json({ error: 'Radar not found.' });
    if (req.body && req.body.active === true && !existing.active) {
      const activeCount = await db
        .prepare('SELECT COUNT(*) AS count FROM capital_flow_radars WHERE user_id = ? AND active = 1')
        .get(req.user.id);
      if (Number(activeCount && activeCount.count) >= MAX_ACTIVE_RADARS_PER_USER) {
        return res.status(409).json({ code: 'RADAR_ACTIVE_LIMIT_REACHED', error: RADAR_ACTIVE_LIMIT_MESSAGE });
      }
    }
    const row = await updateRadar(req.user.id, id, req.body || {});
    res.json({ radar: serializeRadar(row, []) });
  } catch (error) {
    if (sendValidationError(res, error)) return;
    reportError(error, '[radars PUT]');
    res.status(500).json({ error: 'Radar could not be updated right now.' });
  }
});

router.get('/radars/:id/events', requireEliteOrTrial, async (req, res) => {
  const id = radarId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid Radar id.' });
  try {
    const owned = await getRadarRowForUser(req.user.id, id);
    if (!owned) return res.status(404).json({ error: 'Radar not found.' });
    res.json({ events: await getEventRows(req.user.id, id) });
  } catch (error) {
    reportError(error, '[radars events GET]');
    res.status(500).json({ error: 'Data is not available right now. Try again in a few minutes.' });
  }
});

router.delete('/radars/:id', requireEliteOrTrial, async (req, res) => {
  const id = radarId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid Radar id.' });
  try {
    const deleted = await deleteRadar(req.user.id, id);
    if (!deleted) return res.status(404).json({ error: 'Radar not found.' });
    res.json({ ok: true });
  } catch (error) {
    reportError(error, '[radars DELETE]');
    res.status(500).json({ error: 'Radar could not be removed right now.' });
  }
});

module.exports = router;
