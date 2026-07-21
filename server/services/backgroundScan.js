const { scanTickers } = require('./scanner');
const { SP500, NASDAQ100, ALL_TICKERS } = require('../../tickers');

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

function isMarketOpen() {
  var now = new Date();
  var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  var et = new Date(etStr);
  var day = et.getDay();
  var mins = et.getHours() * 60 + et.getMinutes();
  return day !== 0 && day !== 6 && mins >= 570 && mins < 960;
}

function isPreMarket() {
  var now = new Date();
  var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  var et = new Date(etStr);
  var day = et.getDay();
  var mins = et.getHours() * 60 + et.getMinutes();
  return day !== 0 && day !== 6 && mins >= 240 && mins < 570; // 4:00–9:30 AM ET
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

// Watchlist alert state — tracks which tickers we've already alerted on
// to avoid spamming the same alert every scan cycle
const alertedThisCycle = new Set();

async function checkWatchlistAlerts(results) {
  var broadcastToUser = getBroadcastToUser();
  try {
    const { getAllAlertsGrouped } = require('./watchlistAlerts');
    const byUser = await getAllAlertsGrouped(); // { userId: { AAPL: 2.0, ... }, ... }
    const bySymbol = new Map(results.map((r) => [r.symbol, r]));

    Object.entries(byUser).forEach(function ([userId, thresholds]) {
      Object.entries(thresholds).forEach(function ([symbol, threshold]) {
        const r = bySymbol.get(symbol);
        if (!r || r.volumeRatio < threshold) return;
        // Dedupe per user + symbol + 30-min window
        const key = userId + ':' + symbol + ':' + Math.floor(Date.now() / (30 * 60 * 1000));
        if (alertedThisCycle.has(key)) return;
        alertedThisCycle.add(key);
        const alertPayload = {
          symbol: r.symbol,
          name: r.name,
          title: `${r.symbol} Volume Spike`,
          body: `${r.volumeRatio}x avg volume — ${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}% @ $${r.price.toFixed(2)}`,
          volumeRatio: r.volumeRatio,
          change: r.change,
          price: r.price,
          ts: Date.now(),
        };
        broadcastToUser(Number(userId), 'alert', alertPayload);
        try {
          require('./webPush').sendPushToUser(Number(userId), alertPayload);
        } catch (_) {}
        // Persisted so the alert still shows up in the in-app bell even if
        // the push never reached the device (computer off, dismissed, etc).
        require('./notifications')
          .addNotification(Number(userId), { symbol: r.symbol, title: alertPayload.title, body: alertPayload.body })
          .catch(() => {});
      });
    });
  } catch (err) {
    // This used to be a silent catch — it's why a missing `await` above
    // (getAllAlertsGrouped returning a Promise, so Object.entries saw an
    // empty object) shipped to production and silently dropped every
    // watchlist alert with no error anywhere. Never swallow this again.
    console.error('[checkWatchlistAlerts]', err);
  }
}

async function runBackgroundScan() {
  if (backgroundCache.running) return;
  backgroundCache.running = true;
  var broadcast = getBroadcast();

  try {
    broadcast('scan-status', { running: true });

    var res = await scanTickers(ALL_TICKERS, {
      minVolumeRatio: 1.5,
      minMarketCap: 500000000,
    });

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
    console.error('[Background] Scan failed:', e.message);
    broadcast('scan-status', { running: false, error: e.message });
  }

  backgroundCache.running = false;
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
};
