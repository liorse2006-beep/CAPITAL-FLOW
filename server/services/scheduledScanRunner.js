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
    title = 'Capital Flow — Scan Ready';
    body =
      results.length > 0
        ? `${results.length} stocks with unusual volume. Top: ${results[0].symbol} ${results[0].volumeRatio.toFixed(1)}x avg`
        : 'No unusual volume detected right now.';
  } else if (sched.scan_type === 'maScanner') {
    const { scanMA } = require('./maScanner');
    const res = await scanMA(ALL_TICKERS, { ma: 20, distance: 2, interval: '1d' });
    results = res.results || [];
    title = 'MA Scanner — Scan Ready';
    body =
      results.length > 0
        ? `${results.length} stocks near MA20. Top: ${results[0].symbol}`
        : 'No MA crossings detected right now.';
  } else if (sched.scan_type === 'sectorMoving') {
    const { scanTickers } = require('./scanner');
    const res = await scanTickers(ALL_TICKERS, { minVolumeRatio: 2.0, minMarketCap: 500_000_000 });
    results = res.results || [];
    title = 'Sector Flow — Scan Ready';
    body =
      results.length > 0
        ? `${results.length} sector movers detected. Top: ${results[0].symbol}`
        : 'No sector flow detected right now.';
  }

  await db
    .prepare('UPDATE scheduled_scans SET last_run_at = ?, last_result_count = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), results.length, sched.id);

  try {
    const { sendPushToUser } = require('./webPush');
    await sendPushToUser(sched.user_id, {
      title,
      body,
      tag: 'scheduled-scan-' + sched.scan_type,
      data: { scanType: sched.scan_type, resultCount: results.length, url: '/' },
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
