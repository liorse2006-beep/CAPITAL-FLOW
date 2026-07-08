const router = require('express').Router();
const { requireElite } = require('../middleware/authMiddleware');
const { VAPID_PUBLIC_KEY } = require('../config');
const { saveSubscription, removeSubscription } = require('../services/webPush');
const db = require('../db');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

router.get('/push/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));

router.post('/push/subscribe', requireElite, (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  saveSubscription(req.user.id, sub);
  res.json({ ok: true });
});

router.post('/push/unsubscribe', requireElite, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  removeSubscription(endpoint);
  res.json({ ok: true });
});

router.get('/push/notification-time', requireElite, (req, res) => {
  const row = db.prepare('SELECT notification_time FROM users WHERE id = ?').get(req.user.id);
  res.json({ time: (row && row.notification_time) || null });
});

router.post('/push/notification-time', requireElite, (req, res) => {
  const time = req.body ? req.body.time : undefined;
  if (time !== null && !TIME_RE.test(time || '')) {
    return res.status(400).json({ error: 'time must be "HH:MM" or null' });
  }
  db.prepare('UPDATE users SET notification_time = ? WHERE id = ?').run(time, req.user.id);
  res.json({ ok: true, time });
});

module.exports = router;
