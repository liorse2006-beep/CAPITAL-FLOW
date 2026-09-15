const db = require('../db');
const { getAllAlertsGrouped } = require('./watchlistAlerts');
const { sendPushToUser } = require('./webPush');
const { addNotification } = require('./notifications');
const { reportError } = require('../utils/reportError');

// How many users' push sends run concurrently per batch. A plain
// sequential for-loop here would mean 10,000 users sharing a
// notification_time turns into 10,000 serially-awaited DB queries and
// push calls — this caps the fan-out instead of removing it entirely,
// so one slow push endpoint can't stall everyone behind it.
const DIGEST_CONCURRENCY = 20;

function formatDigestRatio(value) {
  var ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return 'unavailable';
  var formatted = Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return formatted + 'x';
}

function isUsableDigestRow(row) {
  if (!row || !String(row.symbol || '').trim()) return false;
  const statuses = [row.quoteDataStatus, row.dataQuality, row.dataStatus]
    .filter((value) => value != null)
    .map((value) => String(value).toLowerCase());
  return !statuses.some((status) => ['stale', 'unavailable', 'partial'].includes(status));
}

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

function buildDigestPayload(thresholds, results, asOf, dataStatus = 'complete') {
  const availableResults = (Array.isArray(results) ? results : []).filter(isUsableDigestRow);
  var bySymbol = new Map(
    availableResults.map(function (r) {
      return [r.symbol, r];
    })
  );
  var matches = [];
  Object.entries(thresholds).forEach(function ([symbol, minRatio]) {
    var r = bySymbol.get(symbol);
    var ratio = r ? Number(r.volumeRatio) : NaN;
    var threshold = Number(minRatio);
    if (r && Number.isFinite(ratio) && ratio > 0 && Number.isFinite(threshold) && ratio >= threshold) {
      matches.push(Object.assign({}, r, { volumeRatio: ratio }));
    }
  });

  if (matches.length === 0) {
    const partialNoMatch =
      dataStatus === 'partial'
        ? ' No verified threshold crossings were found in the available data; some market data could not be verified.'
        : '';
    return {
      title: 'Capital Flow — Daily Scan',
      body: 'No stocks crossed your thresholds today (as of ' + asOf + ').' + partialNoMatch,
      ts: Date.now(),
      matched: false,
    };
  }
  var summary = matches
    .slice(0, 5)
    .map(function (r) {
      return r.symbol + ' ' + formatDigestRatio(r.volumeRatio);
    })
    .join(', ');
  const partialNote =
    dataStatus === 'partial'
      ? ' Some market data was unavailable or delayed; this digest contains available results only and may not be fully verified. Confirm independently.'
      : '';
  return {
    title:
      (dataStatus === 'partial' ? 'Partial data — ' : '') +
      matches.length +
      ' stock' +
      (matches.length > 1 ? 's' : '') +
      ' crossed your threshold',
    body: summary + (matches.length > 5 ? ', +' + (matches.length - 5) + ' more' : '') + '.' + partialNote,
    ts: Date.now(),
    matched: true,
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
  var results = backgroundCache.results || [];
  var dataStatus = backgroundCache.dataStatus || 'unavailable';
  var asOf = backgroundCache.scanTime
    ? new Date(backgroundCache.scanTime).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })
    : 'unknown';

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
        if (dataStatus === 'unavailable' || results.length === 0) return;
        var payload = buildDigestPayload(thresholds, results, asOf, dataStatus);
        var notificationPromise = payload.matched
          ? addNotification(u.id, { title: payload.title, body: payload.body }).catch(function (err) {
              reportError(err, '[scheduled digest notification]');
            })
          : Promise.resolve();
        var pushPromise = sendPushToUser(u.id, payload).catch(function (err) {
          reportError(err, '[scheduled digest push]');
        });
        // Wait for both durable in-app history and push delivery to settle.
        // This prevents a successful tick from returning while its
        // notification write is still in flight and potentially being lost
        // during a process restart.
        return Promise.all([notificationPromise, pushPromise]);
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
