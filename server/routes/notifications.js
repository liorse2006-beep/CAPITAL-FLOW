const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { reportError } = require('../utils/reportError');
const {
  getNotifications,
  getNotificationDetail,
  getUnreadCount,
  markAllRead,
  removeNotification,
  clearAll,
} = require('../services/notifications');

// One notification's full detail — used when tapping a scheduled-scan push
// notification: it carries that scan's own results, so the app can show
// exactly what the user was notified about instead of a blank/current page.
router.get('/notifications/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const detail = await getNotificationDetail(req.user.id, id);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (err) {
    reportError(err, '[notifications/:id GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      getNotifications(req.user.id),
      getUnreadCount(req.user.id),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    reportError(err, '[notifications GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/notifications/read', requireAuth, async (req, res) => {
  try {
    await markAllRead(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[notifications/read POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/notifications/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    await removeNotification(req.user.id, id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[notifications DELETE id]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/notifications', requireAuth, async (req, res) => {
  try {
    await clearAll(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[notifications DELETE all]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
