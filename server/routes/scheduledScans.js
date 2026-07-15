const router = require('express').Router();
const { requireAuth, requireElite } = require('../middleware/authMiddleware');
const db = require('../db');

const VALID_TYPES = ['capitalFlow', 'maScanner', 'sectorMoving'];
const MAX_SCHEDULES = 3;

// GET /api/scheduled-scans — all tiers can see their own schedules
router.get('/scheduled-scans', requireAuth, async (req, res) => {
  try {
    const rows = await db
      .prepare('SELECT * FROM scheduled_scans WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.id);
    res.json({ schedules: rows });
  } catch (err) {
    console.error('[scheduled-scans GET]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/scheduled-scans — Elite only
router.post('/scheduled-scans', requireElite, async (req, res) => {
  const { scan_type, scan_time } = req.body;
  if (!VALID_TYPES.includes(scan_type)) {
    return res.status(400).json({ error: 'Invalid scan_type' });
  }
  if (!/^\d{2}:\d{2}$/.test(scan_time)) {
    return res.status(400).json({ error: 'scan_time must be HH:MM' });
  }
  try {
    const count = await db
      .prepare('SELECT COUNT(*) as cnt FROM scheduled_scans WHERE user_id = ? AND active = 1')
      .get(req.user.id);
    if (count.cnt >= MAX_SCHEDULES) {
      return res.status(400).json({ error: `Maximum ${MAX_SCHEDULES} active schedules` });
    }
    const result = await db
      .prepare('INSERT INTO scheduled_scans (user_id, scan_type, scan_time) VALUES (?, ?, ?)')
      .run(req.user.id, scan_type, scan_time);
    res.json({ id: result.lastInsertRowid, scan_type, scan_time, active: 1, last_run_at: null, last_result_count: null });
  } catch (err) {
    console.error('[scheduled-scans POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/scheduled-scans/:id — toggle active or update time (Elite only)
router.put('/scheduled-scans/:id', requireElite, async (req, res) => {
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
    console.error('[scheduled-scans PUT]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/scheduled-scans/:id (Elite only)
router.delete('/scheduled-scans/:id', requireElite, async (req, res) => {
  try {
    const result = await db
      .prepare('DELETE FROM scheduled_scans WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[scheduled-scans DELETE]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
