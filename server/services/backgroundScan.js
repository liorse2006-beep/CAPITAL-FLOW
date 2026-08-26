const { scanTickers } = require('./scanner');
const { SP500, NASDAQ100, ALL_TICKERS } = require('../../tickers');
const { reportError } = require('../utils/reportError');
const { isMarketOpen, isPreMarket } = require('./marketCalendar');

var backgroundCache = {
  results: null,
  scanTime: null,
  running: false,
};

// Lazy-require broadcast to avoid circular deps at startup
function getBroadcast() {
  try {
    return require('../routes/stream').broadcast;
  } catch (_) {
    return () => {};
  }
}
function getBroadcastToUser() {
  try {
    return require('../routes/stream').broadcastToUser;
  } catch (_) {
    return () => {};
  }
}

function filterCachedResults(cached, opts) {
  var minRatio = opts.minVolumeRatio || 2.5;
  var minCap = opts.minMarketCap || 1000000000;
  var minP = opts.minPrice || 0;
  var maxP = opts.maxPrice || 0;
  var minVolRaw = opts.minVolRaw || '';
  var list = opts.list || 'all';

  function parseVol(str) {
    if (!str) return 0;
    var s = str.toString().toUpperCase().trim();
    if (s.endsWith('B')) return parseFloat(s) * 1e9;
    if (s.endsWith('M')) return parseFloat(s) * 1e6;
    if (s.endsWith('K')) return parseFloat(s) * 1e3;
    return parseFloat(s) || 0;
  }
  var minVolNum = parseVol(minVolRaw);

  var allowedSymbols = null;
  if (list === 'sp500') allowedSymbols = new Set(SP500);
  else if (list === 'nasdaq100') allowedSymbols = new Set(NASDAQ100);

  return cached.filter(function (r) {
    if (allowedSymbols && !allowedSymbols.has(r.symbol)) return false;
    if (r.volumeRatio < minRatio) return false;
    if (r.marketCap < minCap) return false;
    if (minP > 0 && r.price < minP) return false;
    if (maxP > 0 && r.price > maxP) return false;
    if (minVolNum > 0 && r.volume < minVolNum) return false;
    return true;
  });
}

// True once the alert's condition is met for this cycle's quote — volume
// alerts fire at-or-above the threshold; price alerts fire the moment the
// live price is on the opposite side of target_price from where it started
// (an actual crossing, not "happened to already be past it").
function alertTriggered(alert, r) {
  if (alert.type === 'price') {
    const side = r.price >= alert.targetPrice ? 'above' : 'below';
    return side !== alert.startingSide;
  }
  return r.volumeRatio >= alert.minRatio;
}

function alertNotificationPayload(alert, r) {
  if (alert.type === 'price') {
    return {
      symbol: r.symbol,
      name: r.name,
      title: `${r.symbol} Price Alert`,
      body: `Crossed $${alert.targetPrice} — now $${r.price.toFixed(2)} (${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}%)`,
      targetPrice: alert.targetPrice,
      change: r.change,
      price: r.price,
      ts: Date.now(),
    };
  }
  return {
    symbol: r.symbol,
    name: r.name,
    title: `${r.symbol} Volume Spike`,
    body: `${r.volumeRatio}x avg volume — ${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}% @ $${r.price.toFixed(2)}`,
    volumeRatio: r.volumeRatio,
    change: r.change,
    price: r.price,
    ts: Date.now(),
  };
}

async function checkWatchlistAlerts(results) {
  var broadcastToUser = getBroadcastToUser();
  try {
    const { getAllAlertsGrouped, removeAlert } = require('./watchlistAlerts');
    const byUser = await getAllAlertsGrouped(); // { userId: { AAPL: {type,...}, ... }, ... }
    const bySymbol = new Map(results.map((r) => [r.symbol, r]));

    for (const [userId, alerts] of Object.entries(byUser)) {
      for (const [symbol, alert] of Object.entries(alerts)) {
        const r = bySymbol.get(symbol);
        if (!r || !alertTriggered(alert, r)) continue;
        // One-shot: the threshold is a standing "order" the user placed —
        // once it fires we cancel it immediately (delete the row) so it
        // never re-fires on the next cycle while the condition stays true.
        // The user has to re-arm it deliberately to watch for the next move.
        // Awaited (not fire-and-forget) so the cancellation is guaranteed to
        // have landed before the next scan cycle can possibly read it again.
        await removeAlert(Number(userId), symbol);
        const alertPayload = alertNotificationPayload(alert, r);
        broadcastToUser(Number(userId), 'alert', alertPayload);
        try {
          await require('./webPush').sendPushToUser(Number(userId), alertPayload);
        } catch (err) {
          reportError(err, '[checkWatchlistAlerts push]');
        }
        // Persisted so the alert still shows up in the in-app bell even if
        // the push never reached the device (computer off, dismissed, etc).
        require('./notifications')
          .addNotification(Number(userId), { symbol: r.symbol, title: alertPayload.title, body: alertPayload.body })
          .catch(() => {});
      }
    }
  } catch (err) {
    // This used to be a silent catch — it's why a missing `await` above
    // (getAllAlertsGrouped returning a Promise, so Object.entries saw an
    // empty object) shipped to production and silently dropped every
    // watchlist alert with no error anywhere. Never swallow this again.
    reportError(err, '[checkWatchlistAlerts]');
  }
}

// Every individual outbound HTTP call the scan makes now carries its own
// timeout (see server/utils/fetchWithTimeout.js and services/yahoo.js), so a
// single stalled connection can't hang this forever — but this is a second,
// independent line of defense: a hard ceiling on the WHOLE scan cycle, so
// even a bug that bypasses those (a retry loop with no cap, a Promise that
// never settles for an unrelated reason) can't leave backgroundCache.running
// stuck true permanently and freeze every future tick's
// `if (backgroundCache.running) return` check for the rest of the process's
// uptime — potentially days or weeks on a server that's never restarted.
const MAX_SCAN_DURATION_MS = 5 * 60 * 1000;

function withHardTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms hard timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runBackgroundScan() {
  if (backgroundCache.running) return;
  backgroundCache.running = true;
  var broadcast = getBroadcast();

  try {
    broadcast('scan-status', { running: true });

    var res = await withHardTimeout(
      scanTickers(ALL_TICKERS, { minVolumeRatio: 1.5, minMarketCap: 500000000 }),
      MAX_SCAN_DURATION_MS,
      'Background scan'
    );

    backgroundCache.results = res.results;
    backgroundCache.scanTime = new Date().toISOString();
    console.log(`[Background] ${res.results.length} results at ${backgroundCache.scanTime}`);

    // Push live results to all connected SSE clients
    broadcast('scan-update', {
      results: res.results.slice(0, 50), // top 50 to keep payload light
      scanTime: backgroundCache.scanTime,
    });

    // Check watchlist thresholds
    await checkWatchlistAlerts(res.results);

  } catch (e) {
    reportError(e, '[Background] Scan failed');
    broadcast('scan-status', { running: false, error: e.message });
  } finally {
    // Guaranteed to run even if the hard timeout above fired, or anything
    // else in the try block threw something unexpected — the scheduler must
    // never be permanently stuck believing a scan is still in progress.
    backgroundCache.running = false;
  }

  broadcast('scan-status', { running: false });
}

function startBackgroundScheduler() {
  // Run immediately on startup if market is open
  if (isMarketOpen() || isPreMarket()) {
    setTimeout(runBackgroundScan, 5000);
  }

  setInterval(function () {
    if (!isMarketOpen() && !isPreMarket()) return;
    if (backgroundCache.running) return;
    if (backgroundCache.scanTime) {
      var ageMs = Date.now() - new Date(backgroundCache.scanTime).getTime();
      if (ageMs < 15 * 60 * 1000) return; // max once per 15 min
    }
    runBackgroundScan();
  }, 60000);
}

module.exports = {
  backgroundCache,
  isMarketOpen,
  isPreMarket,
  filterCachedResults,
  runBackgroundScan,
  startBackgroundScheduler,
  checkWatchlistAlerts,
  withHardTimeout, // exported for the watchdog regression test
};
