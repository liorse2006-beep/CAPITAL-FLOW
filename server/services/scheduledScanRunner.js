const db = require('../db');
const { reportError } = require('../utils/reportError');
const { isMarketOpen, isPreMarket } = require('./backgroundScan');
const { MA_PERIODS, MA_DISTANCES, MA_INTERVALS, MA_DIRECTIONS, CONDITION_MODES } = require('./radarLogic');

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
const RADAR_RUN_LEASE_SECONDS = 10 * 60;
const MAX_RADAR_RUN_ATTEMPTS = 2;
const RADAR_RECOVERY_WINDOW_MIN = 20;

function isRadarMarketWindow(now = new Date()) {
  if (isMarketOpen(now) || isPreMarket(now)) return true;
  // 23:00 in Israel is the exact regular-session close in New York. Permit
  // that close minute so the last selectable slot can run on the final
  // available quote, but do not keep accepting scans after the close.
  return isMarketOpen(new Date(now.getTime() - 60 * 1000));
}

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

function normalizedRadarRecipe(row) {
  const period = Number(row.ma_period);
  const distance = Number(row.ma_distance);
  const interval = String(row.ma_interval || '1d');
  const direction = String(row.ma_direction || 'all');
  return {
    maPeriod: MA_PERIODS.includes(period) ? period : 20,
    maDistance: MA_DISTANCES.includes(distance) ? distance : 2,
    maInterval: MA_INTERVALS.includes(interval) ? interval : '1d',
    maDirection: MA_DIRECTIONS.includes(direction) ? direction : 'all',
    conditionMode: CONDITION_MODES.includes(String(row.condition_mode || '')) ? row.condition_mode : 'both',
    conditionVersion: String(row.condition_version || 'radar-v2'),
  };
}

async function hasRecoverableRadarRun(radarId, runDate, scheduledTime, nowSeconds) {
  const run = await db
    .prepare(
      `SELECT status, attempts, started_at, completed_at, lease_until
         FROM radar_schedule_runs
        WHERE radar_id = ? AND run_date = ? AND scheduled_time = ?`
    )
    .get(radarId, runDate, scheduledTime);
  return (
    run &&
    ((run.status === 'pending' &&
      Number(run.lease_until || 0) < nowSeconds &&
      Number(run.started_at || 0) >= nowSeconds - RADAR_RECOVERY_WINDOW_MIN * 60) ||
      (run.status === 'failed' &&
        Number(run.attempts || 0) < MAX_RADAR_RUN_ATTEMPTS &&
        Number(run.completed_at || 0) >= nowSeconds - RADAR_RECOVERY_WINDOW_MIN * 60))
  );
}

async function claimRadarRun(radarId, runDate, scheduledTime, nowSeconds) {
  const leaseUntil = nowSeconds + RADAR_RUN_LEASE_SECONDS;
  // A worker can disappear after claiming a slot but before persisting its
  // result. Reclaim only an expired pending row; a failed row gets one
  // bounded retry inside the same delivery window, while completed rows
  // remain idempotently closed for the rest of that calendar day.
  const recovered = await db
    .prepare(
      `UPDATE radar_schedule_runs
          SET started_at = ?, completed_at = NULL, status = 'pending',
              error_code = NULL, error_json = NULL, lease_until = ?,
              attempts = COALESCE(attempts, 0) + 1
        WHERE radar_id = ? AND run_date = ? AND scheduled_time = ?
          AND (
            (status = 'pending' AND (lease_until IS NULL OR lease_until < ?))
            OR (status = 'failed' AND attempts < ? AND completed_at >= ?)
          )`
    )
    .run(
      nowSeconds,
      leaseUntil,
      radarId,
      runDate,
      scheduledTime,
      nowSeconds,
      MAX_RADAR_RUN_ATTEMPTS,
      nowSeconds - RADAR_RECOVERY_WINDOW_MIN * 60
    );
  if (Number(recovered && (recovered.rowsAffected ?? recovered.changes ?? 0)) > 0) return true;

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO radar_schedule_runs
        (radar_id, run_date, scheduled_time, started_at, status, attempts, lease_until)
       VALUES (?, ?, ?, ?, 'pending', 1, ?)`
    )
    .run(radarId, runDate, scheduledTime, nowSeconds, leaseUntil);
  return Number(result && (result.rowsAffected ?? result.changes ?? 0)) > 0;
}

async function finishRadarRuns(runs, status, resultCount, errorCode, metadata = {}) {
  const completedAt = Number.isSafeInteger(metadata.completedAt) ? metadata.completedAt : Math.floor(Date.now() / 1000);
  const errorJson =
    Array.isArray(metadata.errors) && metadata.errors.length > 0 ? JSON.stringify(metadata.errors.slice(0, 100)) : null;
  await Promise.all(
    runs.map((run) =>
      db
        .prepare(
          `UPDATE radar_schedule_runs
              SET status = ?, completed_at = ?, result_count = ?, error_code = ?,
                  error_json = ?, lease_until = NULL, scan_id = ?, data_status = ?,
                  data_as_of = ?, capital_flow_count = ?, ma_count = ?
            WHERE radar_id = ? AND run_date = ? AND scheduled_time = ?`
        )
        .run(
          status,
          completedAt,
          resultCount == null ? null : resultCount,
          errorCode || null,
          errorJson,
          metadata.scanId || null,
          metadata.dataStatus || null,
          metadata.dataAsOf || null,
          metadata.capitalFlowCount == null ? null : metadata.capitalFlowCount,
          metadata.maCount == null ? null : metadata.maCount,
          run.radarId,
          run.runDate,
          run.scheduledTime
        )
    )
  );
}

async function saveRadarRunSnapshot(snapshot) {
  if (!snapshot || !snapshot.scanId) return;
  try {
    await db
      .prepare(
        `INSERT INTO radar_run_snapshots
          (scan_id, started_at, completed_at, capital_flow_as_of, ma_as_of, data_status,
           condition_version, ma_period, ma_distance, ma_interval, ma_direction,
           result_count, checked_count, error_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scan_id) DO UPDATE SET
           completed_at = excluded.completed_at,
           capital_flow_as_of = excluded.capital_flow_as_of,
           ma_as_of = excluded.ma_as_of,
           data_status = excluded.data_status,
           condition_version = excluded.condition_version,
           ma_period = excluded.ma_period,
           ma_distance = excluded.ma_distance,
           ma_interval = excluded.ma_interval,
           ma_direction = excluded.ma_direction,
           result_count = excluded.result_count,
           checked_count = excluded.checked_count,
           error_json = excluded.error_json`
      )
      .run(
        snapshot.scanId,
        snapshot.startedAt || new Date().toISOString(),
        snapshot.completedAt || new Date().toISOString(),
        snapshot.capitalFlowAsOf || null,
        snapshot.maAsOf || null,
        snapshot.dataStatus || 'unavailable',
        snapshot.conditionVersion || 'radar-v2',
        snapshot.maPeriod || null,
        snapshot.maDistance || null,
        snapshot.maInterval || null,
        snapshot.maDirection || 'all',
        Number(snapshot.resultCount || 0),
        Number(snapshot.checkedCount || 0),
        JSON.stringify(Array.isArray(snapshot.errors) ? snapshot.errors.slice(0, 100) : [])
      );
  } catch (err) {
    // Snapshot history is diagnostic metadata; an unavailable history write
    // must never prevent the actual Radar state from being finalized.
    reportError(err, '[Radar scheduler] snapshot write failed');
  }
}

/**
 * Runs Capital Flow Radar only at the two user-selected slots. The scan is
 * shared for every Radar due in the same scheduler tick, while each slot is
 * claimed idempotently in the database so restarts cannot duplicate it.
 */
async function runRadarScheduledScans(now = new Date(), options = {}) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  // The selectable 11:00–23:00 Jerusalem window covers the US pre-market
  // and regular session. Allow both so an 11:00 choice is a real scheduled
  // check instead of being silently discarded before the NYSE open.
  if (!options.ignoreMarketHours && !isRadarMarketWindow(referenceNow)) return;

  const nowMinutes = israelNowMinutes(referenceNow);
  const runDate = israelToday(referenceNow);
  let rows;
  try {
    rows = await db
      .prepare(
        `SELECT id, mode, schedule_time_1, schedule_time_2, expires_on,
                ma_period, ma_distance, ma_interval, ma_direction, condition_mode, condition_version
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
  const nowSeconds = Math.floor(referenceNow.getTime() / 1000);
  for (const row of rows) {
    for (const scheduledTime of [row.schedule_time_1, row.schedule_time_2]) {
      if (
        !scheduledTime ||
        (!isDue(scheduledTime, nowMinutes) &&
          !(await hasRecoverableRadarRun(row.id, runDate, scheduledTime, nowSeconds)))
      )
        continue;
      try {
        if (await claimRadarRun(row.id, runDate, scheduledTime, nowSeconds)) {
          const recipe = normalizedRadarRecipe(row);
          dueRuns.push({
            radarId: Number(row.id),
            runDate,
            scheduledTime,
            ...recipe,
          });
        }
      } catch (err) {
        reportError(err, `[Radar scheduler] claim failed for ${row.id}`);
      }
    }
  }
  if (dueRuns.length === 0) return;

  const { ALL_TICKERS } = require('../../tickers');
  let capitalFlowScan;
  const scanStartedAt = new Date().toISOString();
  try {
    const { scanTickers } = require('./scanner');
    capitalFlowScan = await scanTickers(ALL_TICKERS, {
      minVolumeRatio: 1.5,
      minMarketCap: 500_000_000,
    });
  } catch (err) {
    reportError(err, '[Radar scheduler] scan failed');
    // An Either-condition Radar can still make a valid decision from the MA
    // source if Capital Flow is unavailable. The per-Radar status below keeps
    // Both-condition Radars unavailable until both inputs are usable.
    capitalFlowScan = {
      results: [],
      errors: [...ALL_TICKERS],
      checkedSymbols: [],
      dataStatus: 'unavailable',
      dataAsOf: scanStartedAt,
    };
  }

  const capitalFlowResults = Array.isArray(capitalFlowScan.results) ? capitalFlowScan.results : [];
  const capitalFlowErrors = Array.isArray(capitalFlowScan.errors) ? capitalFlowScan.errors : [];
  const capitalFlowChecked = new Set(
    (Array.isArray(capitalFlowScan.checkedSymbols)
      ? capitalFlowScan.checkedSymbols
      : ALL_TICKERS.filter((symbol) => !capitalFlowErrors.includes(symbol))
    )
      .map((symbol) =>
        String(symbol || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  );
  const capitalFlowAsOf = capitalFlowScan.dataAsOf || new Date().toISOString();

  // The MA chart work is shared by exact recipe settings. A Radar still
  // applies its own Capital Flow thresholds and universe locally, so users
  // can customize those filters without multiplying provider requests.
  const groups = new Map();
  dueRuns.forEach((run) => {
    const key = [run.maPeriod, run.maDistance, run.maInterval].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  });

  for (const runs of groups.values()) {
    const first = runs[0];
    const groupIds = [...new Set(runs.map((run) => run.radarId))];
    const scanId = `radar-${runDate}-${first.maPeriod}-${first.maDistance}-${first.maInterval}-${Date.now()}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    let maScan;
    try {
      const { scanMA } = require('./maScanner');
      maScan = await scanMA(ALL_TICKERS, {
        ma: first.maPeriod,
        distance: first.maDistance,
        interval: first.maInterval,
        direction: 'all',
      });
    } catch (err) {
      reportError(err, '[Radar scheduler] MA scan failed');
      // Keep the Capital Flow result available for Either-condition Radars.
      // Both-condition Radars are marked unavailable below because the MA
      // input is missing, so they cannot emit a composite signal.
      maScan = {
        results: [],
        errors: [...ALL_TICKERS],
        checkedSymbols: [],
        dataStatus: 'unavailable',
        dataAsOf: scanStartedAt,
      };
    }

    const maResults = Array.isArray(maScan.results) ? maScan.results : [];
    const capitalFlowBySymbol = new Map(
      capitalFlowResults
        .map((row) => [
          String(row && row.symbol ? row.symbol : '')
            .trim()
            .toUpperCase(),
          row,
        ])
        .filter(([symbol]) => symbol)
    );

    // A sector-scoped Either-condition Radar must be able to evaluate a
    // moving-average-only match against the same selected sectors. Sector
    // metadata is cached for seven days, so this only adds lookups for MA
    // candidates that are not already present in the Capital Flow result.
    const needsSectorEnrichment = runs.some((run) => run.conditionMode === 'either' && run.mode === 'sectors');
    let enrichedMaResults = maResults;
    if (needsSectorEnrichment && maResults.length > 0) {
      const { enrichSector } = require('./scanner');
      enrichedMaResults = await Promise.all(
        maResults.map(async (row) => {
          const symbol = String(row && row.symbol ? row.symbol : '')
            .trim()
            .toUpperCase();
          if (!symbol || capitalFlowBySymbol.has(symbol)) return row;
          return { ...row, sector: await enrichSector(symbol) };
        })
      );
    }

    const maBySymbol = new Map(
      enrichedMaResults
        .map((row) => [
          String(row && row.symbol ? row.symbol : '')
            .trim()
            .toUpperCase(),
          row,
        ])
        .filter(([symbol]) => symbol)
    );
    const compositeSymbols = [...new Set([...capitalFlowBySymbol.keys(), ...maBySymbol.keys()])];
    const compositeResults = compositeSymbols.map((symbol) => {
      const capitalFlowRow = capitalFlowBySymbol.get(symbol);
      const maRow = maBySymbol.get(symbol);
      const row = { ...(capitalFlowRow || maRow) };
      if (maRow) {
        Object.assign(row, {
          maValue: maRow.maValue,
          maDistance: maRow.maDistance,
          maDirection: maRow.maDirection || maRow.direction,
          maPeriod: maRow.maPeriod || first.maPeriod,
          maInterval: maRow.maInterval || first.maInterval,
          daysSinceCross: maRow.daysSinceCross,
          dataQuality: maRow.dataQuality || 'complete',
        });
      }
      return row;
    });

    const maErrors = Array.isArray(maScan.errors) ? maScan.errors : [];
    const maChecked = new Set(
      (Array.isArray(maScan.checkedSymbols)
        ? maScan.checkedSymbols
        : ALL_TICKERS.filter((symbol) => !maErrors.includes(symbol))
      )
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    );
    const checkedSymbols = [...capitalFlowChecked].filter((symbol) => maChecked.has(symbol));
    const errors = [...new Set([...capitalFlowErrors, ...maErrors])];
    const capitalFlowUnavailable = capitalFlowScan.dataStatus === 'unavailable';
    const maUnavailable = maScan.dataStatus === 'unavailable';
    const sourceIsPartial =
      errors.length > 0 || capitalFlowScan.dataStatus === 'partial' || maScan.dataStatus === 'partial';
    const dataStatus =
      capitalFlowUnavailable && maUnavailable
        ? 'unavailable'
        : sourceIsPartial || capitalFlowUnavailable || maUnavailable
          ? 'partial'
          : 'complete';
    const conditionStatusByRadarId = {};
    runs.forEach((run) => {
      const unavailable =
        run.conditionMode === 'either'
          ? capitalFlowUnavailable && maUnavailable
          : capitalFlowUnavailable || maUnavailable;
      conditionStatusByRadarId[String(run.radarId)] = unavailable
        ? 'unavailable'
        : sourceIsPartial
          ? 'partial'
          : 'complete';
    });
    const maAsOf = maScan.dataAsOf || scanStartedAt;
    const scanTime = maAsOf > capitalFlowAsOf ? maAsOf : capitalFlowAsOf;

    try {
      await require('./radar').processRadarScan(compositeResults, scanTime, {
        errors,
        checkedSymbols,
        dataStatus,
        radarIds: groupIds,
        scanId,
        startedAt: scanStartedAt,
        capitalFlowAsOf,
        maAsOf,
        dataAsOf: scanTime,
        conditionVersion: first.conditionVersion,
        maDirection: 'all',
        conditionStatusByRadarId,
      });
      await saveRadarRunSnapshot({
        scanId,
        startedAt: scanStartedAt,
        completedAt: new Date().toISOString(),
        capitalFlowAsOf,
        maAsOf,
        dataStatus,
        conditionVersion: first.conditionVersion,
        maPeriod: first.maPeriod,
        maDistance: first.maDistance,
        maInterval: first.maInterval,
        maDirection: 'all',
        resultCount: compositeResults.length,
        checkedCount: checkedSymbols.length,
        errors,
      });
      const unavailableRuns = runs.filter((run) => conditionStatusByRadarId[String(run.radarId)] === 'unavailable');
      const completedRuns = runs.filter((run) => conditionStatusByRadarId[String(run.radarId)] !== 'unavailable');
      if (completedRuns.length > 0) {
        await finishRadarRuns(completedRuns, 'completed', compositeResults.length, null, {
          errors,
          dataStatus,
          scanId,
          dataAsOf: scanTime,
          capitalFlowCount: capitalFlowResults.length,
          maCount: maResults.length,
          completedAt: nowSeconds,
        });
      }
      if (unavailableRuns.length > 0) {
        await finishRadarRuns(unavailableRuns, 'failed', null, 'SCAN_UNAVAILABLE', {
          errors,
          dataStatus: 'unavailable',
          scanId,
          dataAsOf: scanTime,
          capitalFlowCount: capitalFlowResults.length,
          maCount: maResults.length,
          completedAt: nowSeconds,
        });
      }
    } catch (err) {
      reportError(err, '[Radar scheduler] composite processing failed');
      try {
        await require('./radar').markRadarsUnavailable(groupIds, {
          scanId,
          errors: [err.code || 'PROCESSING_FAILED'],
          dataAsOf: scanTime,
        });
        await saveRadarRunSnapshot({
          scanId,
          startedAt: scanStartedAt,
          completedAt: new Date().toISOString(),
          capitalFlowAsOf,
          maAsOf,
          dataStatus: 'unavailable',
          conditionVersion: first.conditionVersion,
          maPeriod: first.maPeriod,
          maDistance: first.maDistance,
          maInterval: first.maInterval,
          maDirection: 'all',
          errors: [err.code || 'PROCESSING_FAILED'],
        });
        await finishRadarRuns(runs, 'failed', null, 'PROCESSING_FAILED', {
          errors: [err.code || 'PROCESSING_FAILED'],
          dataStatus: 'unavailable',
          scanId,
          dataAsOf: scanTime,
          capitalFlowCount: capitalFlowResults.length,
          maCount: maResults.length,
          completedAt: nowSeconds,
        });
      } catch (stateError) {
        reportError(stateError, '[Radar scheduler] failed to persist processing failure');
      }
    }
  }
}

let scheduledScanCycleRunning = false;

// One scan per scan_type per tick, shared by every user scheduled for that
// window — ten Elite users scheduled for 16:30 used to trigger ten separate
// full-market scans back-to-back.
async function runScanForType(scanType) {
  const { ALL_TICKERS } = require('../../tickers');
  if (scanType === 'maScanner') {
    const { scanMA } = require('./maScanner');
    const res = await scanMA(ALL_TICKERS, { ma: 20, distance: 2, interval: '1d', direction: 'all' });
    return normalizeScheduledScanResult(res);
  }
  const { scanTickers } = require('./scanner');
  const params =
    scanType === 'sectorMoving'
      ? { minVolumeRatio: 2.0, minMarketCap: 500_000_000 }
      : { minVolumeRatio: 2.5, minMarketCap: 1_000_000_000 };
  const res = await scanTickers(ALL_TICKERS, params);
  return normalizeScheduledScanResult(res);
}

function normalizeScheduledScanResult(scan) {
  const results = Array.isArray(scan) ? scan : Array.isArray(scan?.results) ? scan.results : [];
  const errors = Array.isArray(scan) || !Array.isArray(scan?.errors) ? [] : scan.errors;
  const uniqueSymbols = new Set(
    errors
      .map((symbol) =>
        String(symbol || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  );
  const scannedSymbols = Array.isArray(scan)
    ? results.length
    : Number(scan?.processed || scan?.checkedSymbols?.length || 0);
  const dataStatus =
    scan?.dataStatus ||
    (errors.length === 0
      ? 'complete'
      : scannedSymbols > 0 && uniqueSymbols.size >= scannedSymbols
        ? 'unavailable'
        : 'partial');
  return {
    results,
    errors,
    dataStatus,
    dataAsOf: scan?.dataAsOf || null,
  };
}

function payloadForType(scanType, scan) {
  const results = Array.isArray(scan) ? scan : scan?.results || [];
  const dataStatus = Array.isArray(scan) ? 'complete' : scan?.dataStatus || 'complete';
  if (dataStatus === 'unavailable') {
    const label =
      scanType === 'maScanner' ? 'MA Scanner' : scanType === 'sectorMoving' ? 'Hot Sectors' : 'Capital Flow';
    return {
      title: `${label} — Data unavailable`,
      body: 'Market data is temporarily unavailable. No result was generated. Try again in a few minutes.',
    };
  }
  if (dataStatus === 'partial' && results.length === 0) {
    const label =
      scanType === 'maScanner' ? 'MA Scanner' : scanType === 'sectorMoving' ? 'Hot Sectors' : 'Capital Flow';
    return {
      title: `${label} — Partial data`,
      body: 'Some market data could not be verified. No complete result set was generated. Try again later.',
    };
  }
  const partialNote =
    dataStatus === 'partial' ? ' Some market data could not be verified; review the results with caution.' : '';
  if (scanType === 'maScanner') {
    return results.length > 0
      ? {
          title: `MA signal detected — ${results[0].symbol}`,
          body: `${results.length} stocks near their moving average.${partialNote} Tap to see the full scan.`,
        }
      : { title: 'MA Scanner — Daily Scan', body: 'No MA signals right now. Check back later.' };
  }
  if (scanType === 'sectorMoving') {
    return results.length > 0
      ? {
          title: `Sector flow detected — ${results[0].symbol}`,
          body: `${results.length} sector movers right now.${partialNote} Tap to see the full scan.`,
        }
      : { title: 'Hot Sectors — Daily Scan', body: 'No sector flow right now. Markets look quiet.' };
  }
  return results.length > 0
    ? {
        title: `Volume spike detected — ${results[0].symbol} ${results[0].volumeRatio.toFixed(1)}×`,
        body: `${results.length} stocks moving right now.${partialNote} Tap to see the full scan.`,
      }
    : { title: 'Capital Flow — Daily Scan', body: 'No unusual volume right now. Markets look quiet.' };
}

const SCAN_URL = { capitalFlow: '/scanner', maScanner: '/ma', sectorMoving: '/flow' };

async function notifyScheduledUser(sched, scan) {
  const normalized = normalizeScheduledScanResult(scan);
  const { results } = normalized;
  const { title, body } = payloadForType(sched.scan_type, normalized);

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

  let pushSummary = null;
  try {
    const { sendPushToUser } = require('./webPush');
    var baseUrl = SCAN_URL[sched.scan_type] || '/scanner';
    pushSummary = await sendPushToUser(sched.user_id, {
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

  const pushStatus =
    !pushSummary || !pushSummary.configured
      ? 'push unavailable'
      : pushSummary.devices === 0
        ? 'no push subscription'
        : `push delivered=${pushSummary.delivered}/${pushSummary.devices}`;
  console.log(
    `[ScheduledScans] scan_id=${sched.id} type=${sched.scan_type} status=${normalized.dataStatus} results=${results.length} → ${pushStatus}`
  );
}

async function runScheduledScansCycle() {
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
    let scan;
    try {
      scan = await runScanForType(scanType);
    } catch (err) {
      reportError(err, `[ScheduledScans] ${scanType} scan failed`);
      // A provider failure is a real user-visible outcome. Stamp and notify
      // the schedule instead of silently leaving it due for the next tick or
      // telling the user there were simply no signals.
      scan = {
        results: [],
        errors: ['PROVIDER_UNAVAILABLE'],
        dataStatus: 'unavailable',
        dataAsOf: new Date().toISOString(),
      };
    }
    // Fan out to every subscriber concurrently (bounded), so a 16:30 window
    // shared by hundreds of users clears in a fraction of the time a
    // sequential loop would take — and one slow/failed push never blocks the
    // rest.
    await mapWithConcurrency(scheds, 10, (sched) => notifyScheduledUser(sched, scan));
  }
}

async function runScheduledScans() {
  if (scheduledScanCycleRunning) return;
  scheduledScanCycleRunning = true;
  try {
    await runScheduledScansCycle();
  } finally {
    scheduledScanCycleRunning = false;
  }
}

function startScheduledScanRunner() {
  setInterval(runScheduledScans, 60 * 1000).unref();
}

module.exports = {
  startScheduledScanRunner,
  runScheduledScans,
  runRadarScheduledScans,
  normalizedRadarRecipe,
  isDue,
  FIRE_WINDOW_MIN,
  MAX_RADAR_RUN_ATTEMPTS,
  isRadarMarketWindow,
  israelToday,
  israelNowMinutes,
};
