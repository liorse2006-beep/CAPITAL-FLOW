const db = require('../db');
const { reportError } = require('../utils/reportError');
const { isMarketOpen } = require('./backgroundScan');

// Runs `worker` over every item with at most `limit` in flight at once — a
// bounded fan-out. Used so that when hundreds of users are all scheduled for
// the same minute, their notifications go out concurrently (fast) without
// opening hundreds of simultaneous DB writes and push sends (which would
// spike load). Never rejects: a single failure is isolated to its own item.
async function mapWithConcurrency(items, limit, worker) {
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        await worker(items[idx]);
      } catch (err) {
        reportError(err, '[ScheduledScans] item failed');
      }
    }
  });
  await Promise.all(runners);
}

// A schedule fires when Israel local time is within this many minutes AFTER
// its scan_time (never before). Exact-minute matching used to mean that if
// the server was asleep, redeploying, or mid-scan at that one minute, the
// user's daily push silently never went out.
const FIRE_WINDOW_MIN = 3;

function israelNowMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return Number(map.hour) * 60 + Number(map.minute);
}

function israelToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
}

function hhmmToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when `hhmm` is due: now is 0..FIRE_WINDOW_MIN minutes past it (with midnight wrap). */
function isDue(hhmm, nowMinutes) {
  const t = hhmmToMinutes(hhmm);
  if (t === null) return false;
  const sinceScheduled = (nowMinutes - t + 1440) % 1440;
  return sinceScheduled <= FIRE_WINDOW_MIN;
}

async function claimRadarRun(radarId, runDate, scheduledTime, nowSeconds) {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO radar_schedule_runs
        (radar_id, run_date, scheduled_time, started_at, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(radarId, runDate, scheduledTime, nowSeconds);
  return Number(result && (result.rowsAffected ?? result.changes ?? 0)) > 0;
}

async function finishRadarRuns(runs, status, resultCount, errorCode) {
  const completedAt = Math.floor(Date.now() / 1000);
  await Promise.all(
    runs.map((run) =>
      db
        .prepare(
          `UPDATE radar_schedule_runs
              SET status = ?, completed_at = ?, result_count = ?, error_code = ?
            WHERE radar_id = ? AND run_date = ? AND scheduled_time = ?`
        )
        .run(
          status,
          completedAt,
          resultCount == null ? null : resultCount,
          errorCode || null,
          run.radarId,
          run.runDate,
          run.scheduledTime
        )
    )
  );
}

/**
 * Runs Capital Flow Radar only at the two user-selected slots. The scan is
 * shared for every Radar due in the same scheduler tick, while each slot is
 * claimed idempotently in the database so restarts cannot duplicate it.
 */
async function runRadarScheduledScans(now = new Date(), options = {}) {
  if (!options.ignoreMarketHours && !isMarketOpen(now)) return;

  const nowMinutes = israelNowMinutes(now);
  const runDate = israelToday(now);
  let rows;
  try {
    rows = await db
      .prepare(
        `SELECT id, schedule_time_1, schedule_time_2, expires_on
           FROM capital_flow_radars
          WHERE active = 1
            AND expires_on >= ?`
      )
      .all(runDate);
  } catch (err) {
    reportError(err, '[Radar scheduler] DB error');
    return;
  }

  const dueRuns = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const row of rows) {
    for (const scheduledTime of [row.schedule_time_1, row.schedule_time_2]) {
      if (!scheduledTime || !isDue(scheduledTime, nowMinutes)) continue;
      try {
        if (await claimRadarRun(row.id, runDate, scheduledTime, nowSeconds)) {
          dueRuns.push({ radarId: Number(row.id), runDate, scheduledTime });
        }
      } catch (err) {
        reportError(err, `[Radar scheduler] claim failed for ${row.id}`);
      }
    }
  }
  if (dueRuns.length === 0) return;

  const radarIds = [...new Set(dueRuns.map((run) => run.radarId))];
  let scanResult;
  try {
    const { ALL_TICKERS } = require('../../tickers');
    const { scanTickers } = require('./scanner');
    scanResult = await scanTickers(ALL_TICKERS, {
      minVolumeRatio: 1.5,
      minMarketCap: 500_000_000,
    });
  } catch (err) {
    reportError(err, '[Radar scheduler] scan failed');
    try {
      await require('./radar').markRadarsUnavailable(radarIds);
      await finishRadarRuns(dueRuns, 'failed', null, 'SCAN_UNAVAILABLE');
    } catch (stateError) {
      reportError(stateError, '[Radar scheduler] failed to persist unavailable state');
    }
    return;
  }

  const scanTime = new Date().toISOString();
  try {
    await require('./radar').processRadarScan(scanResult.results || [], scanTime, {
      errors: scanResult.errors || [],
      radarIds,
    });
    await finishRadarRuns(dueRuns, 'completed', (scanResult.results || []).length, null);
  } catch (err) {
    reportError(err, '[Radar scheduler] processing failed');
    try {
      await require('./radar').markRadarsUnavailable(radarIds);
      await finishRadarRuns(dueRuns, 'failed', null, 'PROCESSING_FAILED');
    } catch (stateError) {
      reportError(stateError, '[Radar scheduler] failed to persist processing failure');
    }
  }
}

// One scan per scan_type per tick, shared by every user scheduled for that
// window — ten Elite users scheduled for 16:30 used to trigger ten separate
// full-market scans back-to-back.
async function runScanForType(scanType) {
  const { ALL_TICKERS } = require('../../tickers');
  if (scanType === 'maScanner') {
    const { scanMA } = require('./maScanner');
    const res = await scanMA(ALL_TICKERS, { ma: 20, distance: 2, interval: '1d' });
    return res.results || [];
  }
  const { scanTickers } = require('./scanner');
  const params =
    scanType === 'sectorMoving'
      ? { minVolumeRatio: 2.0, minMarketCap: 500_000_000 }
      : { minVolumeRatio: 2.5, minMarketCap: 1_000_000_000 };
  const res = await scanTickers(ALL_TICKERS, params);
  return res.results || [];
}

function payloadForType(scanType, results) {
  if (scanType === 'maScanner') {
    return results.length > 0
      ? {
          title: `MA signal detected — ${results[0].symbol}`,
          body: `${results.length} stocks near their moving average. Tap to see the full scan.`,
        }
      : { title: 'MA Scanner — Daily Scan', body: 'No MA signals right now. Check back later.' };
  }
  if (scanType === 'sectorMoving') {
    return results.length > 0
      ? {
          title: `Sector flow detected — ${results[0].symbol}`,
          body: `${results.length} sector movers right now. Tap to see the full scan.`,
        }
      : { title: 'Hot Sectors — Daily Scan', body: 'No sector flow right now. Markets look quiet.' };
  }
  return results.length > 0
    ? {
        title: `Volume spike detected — ${results[0].symbol} ${results[0].volumeRatio.toFixed(1)}×`,
        body: `${results.length} stocks moving right now. Tap to see the full scan.`,
      }
    : { title: 'Capital Flow — Daily Scan', body: 'No unusual volume right now. Markets look quiet.' };
}

const SCAN_URL = { capitalFlow: '/scanner', maScanner: '/ma', sectorMoving: '/flow' };

async function notifyScheduledUser(sched, results) {
  const { title, body } = payloadForType(sched.scan_type, results);

  // A one-time schedule (scan_date set) has done its one job — deactivate it
  // the moment it fires so it can't run again. A recurring one (scan_date
  // null) stays active for tomorrow.
  await db
    .prepare(
      `UPDATE scheduled_scans
       SET last_run_at = ?, last_result_count = ?, active = CASE WHEN scan_date IS NOT NULL THEN 0 ELSE active END
       WHERE id = ?`
    )
    .run(Math.floor(Date.now() / 1000), results.length, sched.id);

  // Persist to the in-app bell FIRST, so the user has proof the scheduled
  // scan actually ran even if they never granted push permission (or the
  // push silently fails). This is the fix for "I scheduled a scan and
  // nothing happened" — previously the only output was a push, which is
  // invisible with no subscription. The notification carries the scan's own
  // results too, so tapping it (in-app or from the push) shows exactly what
  // that run found instead of dropping the user on the homepage as if
  // nothing had happened.
  // No `symbol` here — this is a digest of possibly many results (the body
  // says "N stocks moving right now"), so a single ticker would misrepresent
  // it as being about one stock. scanType is what the bell uses to label it.
  var notifId = null;
  try {
    notifId = await require('./notifications').addNotification(sched.user_id, {
      title,
      body,
      scanType: sched.scan_type,
      results,
    });
  } catch (notifErr) {
    reportError(notifErr, '[ScheduledScans] Persisting notification failed');
  }

  try {
    const { sendPushToUser } = require('./webPush');
    var baseUrl = SCAN_URL[sched.scan_type] || '/scanner';
    await sendPushToUser(sched.user_id, {
      title,
      body,
      tag: 'scheduled-scan-' + sched.scan_type,
      data: {
        scanType: sched.scan_type,
        resultCount: results.length,
        url: notifId ? baseUrl + '?notif=' + notifId : baseUrl,
      },
    });
  } catch (pushErr) {
    reportError(pushErr, '[ScheduledScans] Push failed');
  }

  console.log(`[ScheduledScans] scan_id=${sched.id} type=${sched.scan_type} results=${results.length} → push sent`);
}

async function runScheduledScans() {
  await runRadarScheduledScans();
  const nowMinutes = israelNowMinutes();
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

  let rows;
  try {
    rows = await db
      .prepare(
        `SELECT * FROM scheduled_scans
         WHERE active = 1
           AND (last_run_at IS NULL OR last_run_at < ?)`
      )
      .all(oneHourAgo);
  } catch (err) {
    reportError(err, '[ScheduledScans] DB error');
    return;
  }

  const today = israelToday();
  const due = rows.filter(
    (sched) => (sched.scan_date == null || sched.scan_date === today) && isDue(sched.scan_time, nowMinutes)
  );
  if (due.length === 0) return;

  // Group by scan type → one scan each, fanned out to every subscriber.
  const byType = new Map();
  due.forEach((sched) => {
    if (!byType.has(sched.scan_type)) byType.set(sched.scan_type, []);
    byType.get(sched.scan_type).push(sched);
  });

  for (const [scanType, scheds] of byType) {
    let results;
    try {
      results = await runScanForType(scanType);
    } catch (err) {
      reportError(err, `[ScheduledScans] ${scanType} scan failed`);
      continue;
    }
    // Fan out to every subscriber concurrently (bounded), so a 16:30 window
    // shared by hundreds of users clears in a fraction of the time a
    // sequential loop would take — and one slow/failed push never blocks the
    // rest.
    await mapWithConcurrency(scheds, 10, (sched) => notifyScheduledUser(sched, results));
  }
}

function startScheduledScanRunner() {
  setInterval(runScheduledScans, 60 * 1000).unref();
}

module.exports = {
  startScheduledScanRunner,
  runScheduledScans,
  runRadarScheduledScans,
  isDue,
  FIRE_WINDOW_MIN,
  israelToday,
  israelNowMinutes,
};
