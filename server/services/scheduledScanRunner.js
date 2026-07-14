const db = require('../db');

function israelNowHHMM() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return map.hour + ':' + map.minute;
}

async function executeScheduledScan(sched) {
  const { ALL_TICKERS } = require('../../tickers');
  let results = [];
  let title = '';
  let body = '';

  if (sched.scan_type === 'capitalFlow') {
    const { scanTickers } = require('./scanner');
    const res = await scanTickers(ALL_TICKERS, { minVolumeRatio: 2.5, minMarketCap: 1_000_000_000 });
    results = res.results || [];
    if (results.length > 0) {
      const top = results[0];
      title = `Volume spike detected — ${top.symbol} ${top.volumeRatio.toFixed(1)}×`;
      body = `${results.length} stocks moving right now. Tap to see the full scan.`;
    } else {
      title = 'Capital Flow — Daily Scan';
      body = 'No unusual volume right now. Markets look quiet.';
    }
  } else if (sched.scan_type === 'maScanner') {
    const { scanMA } = require('./maScanner');
    const res = await scanMA(ALL_TICKERS, { ma: 20, distance: 2, interval: '1d' });
    results = res.results || [];
    if (results.length > 0) {
      title = `MA signal detected — ${results[0].symbol}`;
      body = `${results.length} stocks near their moving average. Tap to see the full scan.`;
    } else {
      title = 'MA Scanner — Daily Scan';
      body = 'No MA signals right now. Check back later.';
    }
  } else if (sched.scan_type === 'sectorMoving') {
    const { scanTickers } = require('./scanner');
    const res = await scanTickers(ALL_TICKERS, { minVolumeRatio: 2.0, minMarketCap: 500_000_000 });
    results = res.results || [];
    if (results.length > 0) {
      title = `Sector flow detected — ${results[0].symbol}`;
      body = `${results.length} sector movers right now. Tap to see the full scan.`;
    } else {
      title = 'Sector Moving — Daily Scan';
      body = 'No sector flow right now. Markets look quiet.';
    }
  }

  const SCAN_URL = { capitalFlow: '/scanner', maScanner: '/ma', sectorMoving: '/flow' };

  await db
    .prepare('UPDATE scheduled_scans SET last_run_at = ?, last_result_count = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), results.length, sched.id);

  try {
    const { sendPushToUser } = require('./webPush');
    await sendPushToUser(sched.user_id, {
      title,
      body,
      tag: 'scheduled-scan-' + sched.scan_type,
      data: { scanType: sched.scan_type, resultCount: results.length, url: SCAN_URL[sched.scan_type] || '/scanner' },
    });
  } catch (pushErr) {
    console.error(`[ScheduledScans] Push failed for user ${sched.user_id}:`, pushErr.message);
  }

  console.log(
    `[ScheduledScans] scan_id=${sched.id} type=${sched.scan_type} results=${results.length} → push sent to user ${sched.user_id}`
  );
}

async function runScheduledScans() {
  const hhmm = israelNowHHMM();
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

  let rows;
  try {
    rows = await db
      .prepare(
        `SELECT * FROM scheduled_scans
         WHERE active = 1
           AND scan_time = ?
           AND (last_run_at IS NULL OR last_run_at < ?)`
      )
      .all(hhmm, oneHourAgo);
  } catch (err) {
    console.error('[ScheduledScans] DB error:', err.message);
    return;
  }

  for (const sched of rows) {
    try {
      await executeScheduledScan(sched);
    } catch (err) {
      console.error(`[ScheduledScans] Error running scan ${sched.id}:`, err.message);
    }
  }
}

function startScheduledScanRunner() {
  setInterval(runScheduledScans, 60 * 1000).unref();
}

module.exports = { startScheduledScanRunner };
