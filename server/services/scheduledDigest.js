const db = require('../db');
const { getWatchlistAlerts } = require('./watchlistAlerts');
const { sendPushToUser } = require('./webPush');

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

function buildDigestPayload(thresholds, results, asOf) {
  var bySymbol = new Map(
    results.map(function (r) {
      return [r.symbol, r];
    })
  );
  var matches = [];
  Object.entries(thresholds).forEach(function ([symbol, minRatio]) {
    var r = bySymbol.get(symbol);
    if (r && r.volumeRatio >= minRatio) matches.push(r);
  });

  if (matches.length === 0) {
    return {
      title: 'Capital Flow — Daily Scan',
      body: 'No stocks crossed your thresholds today (as of ' + asOf + ').',
      ts: Date.now(),
    };
  }
  var summary = matches
    .slice(0, 5)
    .map(function (r) {
      return r.symbol + ' ' + r.volumeRatio + 'x';
    })
    .join(', ');
  return {
    title: matches.length + ' stock' + (matches.length > 1 ? 's' : '') + ' crossed your threshold',
    body: summary + (matches.length > 5 ? ', +' + (matches.length - 5) + ' more' : ''),
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
  var results = backgroundCache.results || [];
  var asOf = backgroundCache.scanTime
    ? new Date(backgroundCache.scanTime).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })
    : 'unknown';

  for (var i = 0; i < users.length; i++) {
    var userId = users[i].id;
    var dedupeKey = userId + ':' + now.date;
    if (sentToday.has(dedupeKey)) continue;
    sentToday.add(dedupeKey);

    var thresholds = await getWatchlistAlerts(userId);
    if (Object.keys(thresholds).length === 0) continue; // nothing to check against

    var payload = buildDigestPayload(thresholds, results, asOf);
    try {
      await sendPushToUser(userId, payload);
    } catch (_) {}
  }
}

function startScheduledDigest() {
  setInterval(function () {
    runDigestTick().catch(function () {});
  }, 60000);
}

module.exports = { israelNow, buildDigestPayload, runDigestTick, startScheduledDigest };
