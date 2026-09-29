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
const DIGEST_SCHEDULE_POLL_MS = 15 * 1000;
const DIGEST_FIRE_WINDOW_MIN = 3;
const NOTIFICATION_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
var notificationTimes = new Set();
var notificationTimesLoaded = false;
var scheduleRefreshPromise = null;
var scheduleRefreshRetryAt = 0;
var digestSchedulerTimer = null;
var digestSchedulerPromise = null;
var processedScheduleSlots = new Set();

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

function isDigestTimeDue(scheduleTime, currentTime) {
  if (!NOTIFICATION_TIME_RE.test(String(scheduleTime || '')) || !/^\d{2}:\d{2}$/.test(String(currentTime || ''))) {
    return false;
  }
  var scheduledMinutes = Number(scheduleTime.slice(0, 2)) * 60 + Number(scheduleTime.slice(3, 5));
  var currentMinutes = Number(currentTime.slice(0, 2)) * 60 + Number(currentTime.slice(3, 5));
  var minutesLate = (currentMinutes - scheduledMinutes + 1440) % 1440;
  return minutesLate <= DIGEST_FIRE_WINDOW_MIN;
}

// Load schedule times once, then let the in-process timer compare the clock
// against this small cache. The old minute poll queried the shared database
// continuously, even when no customer had a digest configured.
async function refreshScheduledDigestTimes(options = {}) {
  if (scheduleRefreshPromise) {
    if (options.force) {
      return scheduleRefreshPromise.then(function () {
        return refreshScheduledDigestTimes({ force: true });
      });
    }
    return scheduleRefreshPromise;
  }
  if (!options.force && Date.now() < scheduleRefreshRetryAt) return notificationTimes.size;
  scheduleRefreshPromise = (async function () {
    try {
      var rows = await db
        .prepare('SELECT DISTINCT notification_time FROM users WHERE notification_time IS NOT NULL')
        .all();
      notificationTimes = new Set(
        rows.map(function (row) {
          return String(row.notification_time || '');
        }).filter(function (time) {
          return NOTIFICATION_TIME_RE.test(time);
        })
      );
      notificationTimesLoaded = true;
      scheduleRefreshRetryAt = 0;
      return notificationTimes.size;
    } catch (err) {
      notificationTimesLoaded = false;
      scheduleRefreshRetryAt = Date.now() + 5 * 60 * 1000;
      throw err;
    }
  })();
  try {
    return await scheduleRefreshPromise;
  } finally {
    scheduleRefreshPromise = null;
  }
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

async function runDigestTick(notificationTime) {
  var now = israelNow();
  if (sentDate !== now.date) {
    sentToday.clear();
    sentDate = now.date;
  }

  var scheduledTime = notificationTime || now.hm;
  var users = await db.prepare('SELECT id FROM users WHERE notification_time = ?').all(scheduledTime);
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
  if (digestSchedulerTimer) return;
  async function checkScheduledDigests() {
    if (digestSchedulerPromise) return;
    if (!notificationTimesLoaded) {
      await refreshScheduledDigestTimes().catch(function (err) {
        reportError(err, '[scheduled digest schedule refresh]');
      });
    }
    if (notificationTimes.size === 0) return;
    var now = israelNow();
    var dueTimes = Array.from(notificationTimes).filter(function (time) {
      return isDigestTimeDue(time, now.hm);
    });
    if (dueTimes.length === 0) return;

    digestSchedulerPromise = (async function () {
      for (var i = 0; i < dueTimes.length; i += 1) {
        var time = dueTimes[i];
        var slot = now.date + ':' + time;
        if (processedScheduleSlots.has(slot)) continue;
        processedScheduleSlots.add(slot);
        try {
          await runDigestTick(time);
        } catch (err) {
          processedScheduleSlots.delete(slot);
          reportError(err, '[scheduled digest tick]');
        }
      }
      if (processedScheduleSlots.size > 500) {
        processedScheduleSlots = new Set(Array.from(processedScheduleSlots).filter(function (slot) {
          return slot.startsWith(now.date + ':');
        }));
      }
    })();
    try {
      await digestSchedulerPromise;
    } finally {
      digestSchedulerPromise = null;
    }
  }

  digestSchedulerTimer = setInterval(function () {
    checkScheduledDigests().catch(function (err) {
      reportError(err, '[scheduled digest scheduler]');
    });
  }, DIGEST_SCHEDULE_POLL_MS);
  digestSchedulerTimer.unref();

  refreshScheduledDigestTimes({ force: true })
    .then(checkScheduledDigests)
    .catch(function (err) {
      reportError(err, '[scheduled digest schedule refresh]');
    });
}

module.exports = {
  israelNow,
  isDigestTimeDue,
  buildDigestPayload,
  runDigestTick,
  refreshScheduledDigestTimes,
  startScheduledDigest,
};
