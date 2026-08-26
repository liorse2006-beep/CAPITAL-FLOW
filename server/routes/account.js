const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiters');
const {
  hashPassword,
  verifyPassword,
  issueToken,
  revokeAllSessions,
  withEffectivePremium,
  MAX_PASSWORD_BYTES,
} = require('../services/auth');
const { quotaFor, freeTrialActive } = require('../services/scanQuota');
const { reportError } = require('../utils/reportError');
const { setRefreshCookie, clearRefreshCookie, serializePublicUser } = require('./auth');

const MAX_EXPORT_ROWS = 5000;

function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES;
}

function jsonOrNull(value) {
  if (value == null || value === '') return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

// The profile summary is intentionally composed from aggregate queries. It
// gives the user useful, current counts without shipping every row into the
// initial profile dialog or exposing technical identifiers.
router.get('/account/summary', requireAuth, async (req, res) => {
  try {
    const user = withEffectivePremium(await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id));
    if (!user) return res.status(401).json({ error: 'Account not found' });

    const [watchlist, alerts, schedules, radars, pushDevices, chatMessages, sessions] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ?').get(user.id),
      db.prepare('SELECT COUNT(*) AS count FROM watchlist_alerts WHERE user_id = ?').get(user.id),
      db
        .prepare(
          'SELECT COUNT(*) AS count, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active FROM scheduled_scans WHERE user_id = ?'
        )
        .get(user.id),
      db
        .prepare(
          'SELECT COUNT(*) AS count, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active FROM capital_flow_radars WHERE user_id = ?'
        )
        .get(user.id),
      db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?').get(user.id),
      db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE user_id = ?').get(user.id),
      db.prepare('SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = ?').get(user.id),
    ]);

    const quota = quotaFor(user);
    res.set('Cache-Control', 'no-store');
    res.json({
      user: serializePublicUser(user),
      plan: {
        tier: user.tier || 'free',
        trialActive: user.tier === 'free' && freeTrialActive(user),
        trialEndsAt: quota.free ? quota.free.trialEndsAt : null,
        access:
          user.tier === 'elite' || (user.tier === 'free' && freeTrialActive(user)) ? 'Full access' : 'Limited access',
      },
      usage: {
        watchlistCount: Number(watchlist?.count || 0),
        alertCount: Number(alerts?.count || 0),
        scheduleCount: Number(schedules?.count || 0),
        activeScheduleCount: Number(schedules?.active || 0),
        radarCount: Number(radars?.count || 0),
        activeRadarCount: Number(radars?.active || 0),
        pushDeviceCount: Number(pushDevices?.count || 0),
        chatMessageCount: Number(chatMessages?.count || 0),
        quota,
      },
      security: {
        authProvider: user.google_id ? 'Google' : user.password_hash ? 'Email and password' : 'Unknown',
        verified: !!user.is_verified,
        activeSessionCount: Number(sessions?.count || 0),
      },
      preferences: { notificationTime: user.notification_time || null },
    });
  } catch (err) {
    reportError(err, '[account/summary GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

// Change-password is a sensitive action: it requires the current password,
// validates the bcrypt boundary, revokes every existing session, and returns
// one fresh session for the device that just completed the change.
router.post('/account/change-password', authLimiter, requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Enter your current password' });
    }
    if (!validPassword(newPassword)) {
      return res.status(400).json({ error: `New password must be 8–${MAX_PASSWORD_BYTES} UTF-8 bytes` });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    if (!user.password_hash) {
      return res.status(400).json({ error: 'This account uses Google sign-in and has no password to change' });
    }
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Choose a new password different from the current one' });
    }

    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), user.id);
    await revokeAllSessions(user.id);
    const freshUser = withEffectivePremium(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
    const { accessToken, refreshToken } = await issueToken(freshUser);
    setRefreshCookie(res, refreshToken);
    res.json({ success: true, token: accessToken, user: serializePublicUser(freshUser) });
  } catch (err) {
    reportError(err, '[account/change-password POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/account/logout-all', authLimiter, requireAuth, async (req, res) => {
  try {
    await revokeAllSessions(req.user.id);
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[account/logout-all POST]');
    res.status(500).json({ error: 'Server error' });
  }
});

// Download only user-owned data. Password hashes, OAuth identifiers, push
// endpoints/keys, refresh sessions and internal provider details are never
// included in this export.
router.get('/account/export', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const [user, watchlist, alerts, schedules, radars, notifications, chatMessages, feedback] = await Promise.all([
      db
        .prepare(
          'SELECT id, email, is_verified, is_premium, is_pilot, tier, created_at, last_login_at FROM users WHERE id = ?'
        )
        .get(userId),
      db.prepare('SELECT symbol, created_at FROM watchlist WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      db
        .prepare(
          'SELECT symbol, type, min_ratio, target_price, starting_side, created_at FROM watchlist_alerts WHERE user_id = ? ORDER BY created_at ASC'
        )
        .all(userId),
      db
        .prepare(
          'SELECT scan_type, scan_time, scan_date, active, last_run_at, last_result_count, created_at FROM scheduled_scans WHERE user_id = ? ORDER BY created_at ASC'
        )
        .all(userId),
      db
        .prepare(
          'SELECT id, name, mode, selected_sectors_json, min_volume_ratio, min_market_cap, min_volume, min_price, max_price, ma_period, ma_distance, ma_interval, ma_direction, condition_version, schedule_time_1, schedule_time_2, expires_on, active, last_check_at, last_success_at, last_error, last_error_detail, last_data_status, last_data_as_of, last_scan_run_id, last_partial_count, created_at, updated_at FROM capital_flow_radars WHERE user_id = ? ORDER BY created_at ASC'
        )
        .all(userId),
      db
        .prepare(
          'SELECT id, symbol, title, body, scan_type, is_read, results_json, created_at FROM notifications WHERE user_id = ? ORDER BY created_at ASC LIMIT ?'
        )
        .all(userId, MAX_EXPORT_ROWS),
      db
        .prepare(
          'SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ?'
        )
        .all(userId, MAX_EXPORT_ROWS),
      db
        .prepare('SELECT message, page, created_at FROM feedback WHERE user_id = ? ORDER BY created_at ASC LIMIT ?')
        .all(userId, MAX_EXPORT_ROWS),
    ]);

    if (!user) return res.status(404).json({ error: 'Account not found' });
    const safeRadars = radars.map((radar) => ({
      ...radar,
      selected_sectors: jsonOrNull(radar.selected_sectors_json) || [],
      selected_sectors_json: undefined,
    }));
    const safeNotifications = notifications.map((notification) => ({
      ...notification,
      results: jsonOrNull(notification.results_json),
      results_json: undefined,
    }));

    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="capital-flow-data.json"');
    res.send(
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        account: {
          id: user.id,
          email: user.email,
          verified: !!user.is_verified,
          tier: user.tier || 'free',
          pilot: !!user.is_pilot,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at,
        },
        data: {
          watchlist,
          alerts,
          schedules,
          radars: safeRadars,
          notifications: safeNotifications,
          chatMessages,
          feedback,
        },
      })
    );
  } catch (err) {
    reportError(err, '[account/export GET]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
