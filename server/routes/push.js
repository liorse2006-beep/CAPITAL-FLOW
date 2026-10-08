const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const { VAPID_PUBLIC_KEY } = require('../config');
const {
  saveSubscription,
  removeSubscription,
  isValidSubscription,
  isValidPushEndpoint,
  isPushConfigured,
} = require('../services/webPush');
const db = require('../db');
const { reportError } = require('../utils/reportError');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

router.get('/push/vapid-public-key', (req, res) => {
  if (!isPushConfigured() || !VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Push notifications are temporarily unavailable' });
  }
  return res.json({ key: VAPID_PUBLIC_KEY });
});

router.post('/push/subscribe', requireEliteOrTrial, async (req, res) => {
  try {
    if (!isPushConfigured()) {
      return res.status(503).json({ error: 'Push notifications are temporarily unavailable' });
    }
    const sub = req.body;
    if (!isValidSubscription(sub)) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }
    await saveSubscription(req.user.id, sub);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[push/subscribe]');
    if (err?.code === 'PUSH_SUBSCRIPTION_LIMIT') {
      return res.status(409).json({ error: 'Notification device limit reached. Remove an old device first.' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Read-only: check the exact device keys and owner, without transferring a
// subscription or exposing another account's registration.
router.post('/push/subscription-status', requireEliteOrTrial, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!isPushConfigured()) {
      return res.status(503).json({ error: 'Push notifications are temporarily unavailable' });
    }
    if (!isValidSubscription(req.body)) {
      return res.status(400).json({ error: 'Could not verify notification access' });
    }
    const { endpoint, keys } = req.body;
    const row = await db
      .prepare('SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ? AND p256dh = ? AND auth = ?')
      .get(req.user.id, new URL(endpoint).href, keys.p256dh, keys.auth);
    return res.json({ enabled: !!row });
  } catch (err) {
    reportError(err, '[push/subscription-status]');
    return res.status(500).json({ error: 'Could not verify notification access' });
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
    require('../services/scheduledDigest')
      .refreshScheduledDigestTimes({ force: true })
      .catch((err) => {
        reportError(err, '[push/notification-time schedule refresh]');
      });
    res.json({ ok: true, time });
  } catch (err) {
    reportError(err, '[push/notification-time POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
