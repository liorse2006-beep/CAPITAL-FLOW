const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { getNotifications, getUnreadCount, markAllRead, removeNotification, clearAll } = require('../services/notifications');

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      getNotifications(req.user.id),
      getUnreadCount(req.user.id),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notifications GET]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/notifications/read', requireAuth, async (req, res) => {
  try {
    await markAllRead(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/read POST]', err);
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
    console.error('[notifications DELETE id]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/notifications', requireAuth, async (req, res) => {
  try {
    await clearAll(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications DELETE all]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
