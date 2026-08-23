const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const { VAPID_PUBLIC_KEY } = require('../config');
const {
  saveSubscription,
  removeSubscription,
  isValidSubscription,
  isValidPushEndpoint,
} = require('../services/webPush');
const db = require('../db');
const { reportError } = require('../utils/reportError');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

router.get('/push/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));

router.post('/push/subscribe', requireEliteOrTrial, async (req, res) => {
  try {
    const sub = req.body;
    if (!isValidSubscription(sub)) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }
    await saveSubscription(req.user.id, sub);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[push/subscribe]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/push/unsubscribe', requireEliteOrTrial, async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (!isValidPushEndpoint(endpoint)) return res.status(400).json({ error: 'Invalid endpoint' });
    await removeSubscription(endpoint, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[push/unsubscribe]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/push/notification-time', requireEliteOrTrial, async (req, res) => {
  try {
    const row = await db.prepare('SELECT notification_time FROM users WHERE id = ?').get(req.user.id);
    res.json({ time: (row && row.notification_time) || null });
  } catch (err) {
    reportError(err, '[push/notification-time GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/push/notification-time', requireEliteOrTrial, async (req, res) => {
  try {
    const time = req.body ? req.body.time : undefined;
    if (time !== null && !TIME_RE.test(time || '')) {
      return res.status(400).json({ error: 'time must be "HH:MM" or null' });
    }
    await db.prepare('UPDATE users SET notification_time = ? WHERE id = ?').run(time, req.user.id);
    res.json({ ok: true, time });
  } catch (err) {
    reportError(err, '[push/notification-time POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
