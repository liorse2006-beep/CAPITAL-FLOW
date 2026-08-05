const router = require('express').Router();
const { requireAuth, requireEliteOrTrial } = require('../middleware/authMiddleware');
const db = require('../db');
const { reportError } = require('../utils/reportError');

const VALID_TYPES = ['capitalFlow', 'maScanner', 'sectorMoving'];
const MAX_SCHEDULES = 3;

/** Current Israel local date/time as "YYYY-MM-DD" and "HH:MM". */
function israelNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return { date: `${map.year}-${map.month}-${map.day}`, hm: `${map.hour}:${map.minute}` };
}

/** A one-time schedule's date+time, rejected once it's already past (Israel time). */
function isPastIsrael(scan_date, scan_time) {
  const now = israelNow();
  if (scan_date > now.date) return false;
  if (scan_date < now.date) return true;
  return scan_time <= now.hm;
}

// GET /api/scheduled-scans — all tiers can see their own schedules
router.get('/scheduled-scans', requireAuth, async (req, res) => {
  try {
    const rows = await db
      .prepare('SELECT * FROM scheduled_scans WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.id);
    res.json({ schedules: rows });
  } catch (err) {
    reportError(err, '[scheduled-scans GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/scheduled-scans — Elite, or a free account still in its 7-day trial
router.post('/scheduled-scans', requireEliteOrTrial, async (req, res) => {
  const { scan_type, scan_time, scan_date } = req.body;
  if (!VALID_TYPES.includes(scan_type)) {
    return res.status(400).json({ error: 'Invalid scan_type' });
  }
  if (!/^\d{2}:\d{2}$/.test(scan_time)) {
    return res.status(400).json({ error: 'scan_time must be HH:MM' });
  }
  // scan_date is optional — omitted means "every day" (the original,
  // recurring behavior). When given, it's a one-time schedule and must be
  // today or later; the runner deactivates it right after it fires.
  if (scan_date !== undefined && scan_date !== null && scan_date !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scan_date)) {
      return res.status(400).json({ error: 'scan_date must be YYYY-MM-DD' });
    }
    if (isPastIsrael(scan_date, scan_time)) {
      return res.status(400).json({ error: 'That date and time have already passed' });
    }
  }
  const dateToStore = scan_date || null;
  try {
    const count = await db
      .prepare('SELECT COUNT(*) as cnt FROM scheduled_scans WHERE user_id = ? AND active = 1')
      .get(req.user.id);
    if (count.cnt >= MAX_SCHEDULES) {
      return res.status(400).json({ error: `Maximum ${MAX_SCHEDULES} active schedules` });
    }
    const result = await db
      .prepare('INSERT INTO scheduled_scans (user_id, scan_type, scan_time, scan_date) VALUES (?, ?, ?, ?)')
      .run(req.user.id, scan_type, scan_time, dateToStore);
    res.json({
      id: result.lastInsertRowid,
      scan_type,
      scan_time,
      scan_date: dateToStore,
      active: 1,
      last_run_at: null,
      last_result_count: null,
    });
  } catch (err) {
    reportError(err, '[scheduled-scans POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/scheduled-scans/:id — toggle active or update time (Elite or trial)
router.put('/scheduled-scans/:id', requireEliteOrTrial, async (req, res) => {
  const { active, scan_time } = req.body;
  try {
    const existing = await db
      .prepare('SELECT * FROM scheduled_scans WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const newActive = typeof active === 'boolean' ? (active ? 1 : 0) : existing.active;
    const newTime =
      scan_time && /^\d{2}:\d{2}$/.test(scan_time) ? scan_time : existing.scan_time;

    await db
      .prepare('UPDATE scheduled_scans SET active = ?, scan_time = ? WHERE id = ?')
      .run(newActive, newTime, existing.id);
    res.json({ id: existing.id, scan_type: existing.scan_type, scan_time: newTime, active: newActive });
  } catch (err) {
    reportError(err, '[scheduled-scans PUT]');
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/scheduled-scans/:id (Elite or trial)
router.delete('/scheduled-scans/:id', requireEliteOrTrial, async (req, res) => {
  try {
    const result = await db
      .prepare('DELETE FROM scheduled_scans WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[scheduled-scans DELETE]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
