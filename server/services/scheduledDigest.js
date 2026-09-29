const db = require('../db');
const { getAllAlertsGrouped } = require('./watchlistAlerts');
const { sendPushToUser } = require('./webPush');
const { addNotification } = require('./notifications');
const { reportError } = require('../utils/reportError');
const { marketSignalNotificationFor } = require('./marketSignalNotification');

// How many users' push sends run concurrently per batch. A plain
// sequential for-loop here would mean 10,000 users sharing a
// notification_time turns into 10,000 serially-awaited DB queries and
// push calls — this caps the fan-out instead of removing it entirely,
// so one slow push endpoint can't stall everyone behind it.
const DIGEST_CONCURRENCY = 20;

/** Current Israel local time as "HH:MM" and "YYYY-MM-DD", for matching against users.notification_time */
function israelNow() {
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  var map = {};
  parts.forEach(function (p) {
    map[p.type] = p.value;
  });
  return { hm: map.hour + ':' + map.minute, date: map.year + '-' + map.month + '-' + map.day };
}

// Tracks which users already got today's digest, so a restart or a slow tick
// can never double-send. Cleared whenever the date rolls over.
var sentToday = new Set();
var sentDate = null;

function buildDigestPayload(results) {
  return {
    ...marketSignalNotificationFor(results),
    ts: Date.now(),
  };
}

async function runDigestTick() {
  var now = israelNow();
  if (sentDate !== now.date) {
    sentToday.clear();
    sentDate = now.date;
  }

  var users = await db.prepare('SELECT id FROM users WHERE notification_time = ?').all(now.hm);
  if (!users.length) return;

  var backgroundCache = require('./backgroundScan').backgroundCache;
  var results = Array.isArray(backgroundCache.results) ? backgroundCache.results : [];

  var allAlerts = await getAllAlertsGrouped();

  var pending = users.filter(function (u) {
    var dedupeKey = u.id + ':' + now.date;
    if (sentToday.has(dedupeKey)) return false;
    sentToday.add(dedupeKey);
    return true;
  });

  for (var i = 0; i < pending.length; i += DIGEST_CONCURRENCY) {
    var batch = pending.slice(i, i + DIGEST_CONCURRENCY);
    await Promise.all(
      batch.map(function (u) {
        var thresholds = allAlerts[u.id] || {};
        if (Object.keys(thresholds).length === 0) return; // nothing to check against
        var payload = buildDigestPayload(results);
        return (async function () {
          var notificationId = null;
          try {
            notificationId = await addNotification(u.id, {
              title: payload.title,
              body: payload.body,
              scanType: 'capitalFlow',
              results,
            });
          } catch (err) {
            reportError(err, '[scheduled digest notification]');
          }

          try {
            await sendPushToUser(u.id, {
              ...payload,
              data: { url: notificationId ? '/scanner?notif=' + notificationId : '/scanner' },
            });
          } catch (err) {
            reportError(err, '[scheduled digest push]');
          }
        })();
      })
    );
  }
}

function startScheduledDigest() {
  setInterval(function () {
    runDigestTick().catch(function (err) {
      reportError(err, '[scheduled digest tick]');
    });
  }, 60000);
}

module.exports = { israelNow, buildDigestPayload, runDigestTick, startScheduledDigest };
