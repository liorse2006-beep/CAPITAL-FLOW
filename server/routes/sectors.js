const router = require('express').Router();
const yahooFinance = require('../services/yahoo');
const { finnhubFetch } = require('../services/finnhub');
const { requireScanQuota } = require('../middleware/authMiddleware');
const { spendScan, quotaFor } = require('../services/scanQuota');

// Sector-flow has no per-user params — every caller gets the same 15 ETFs —
// so a short shared cache turns N concurrent requests into 1 upstream fetch.
var flowCache = { results: null, fetchTime: null, expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

router.get('/sector-flow', requireScanQuota('sectorMoving'), async (req, res) => {
  if (flowCache.results && flowCache.expiresAt > Date.now()) {
    await spendScan(req.user, 'sectorMoving');
    return res.json({
      results: flowCache.results,
      fetchTime: flowCache.fetchTime,
      fromCache: true,
      ...quotaFor(req.user),
    });
  }

  const etfs = [
    'XLK',
    'XLF',
    'XLV',
    'XLY',
    'XLP',
    'XLE',
    'XLI',
    'XLB',
    'XLRE',
    'XLU',
    'XLC',
    'SOXX',
    'XOP',
    'XTL',
    'IGV',
  ];
  try {
    const results = await Promise.all(
      etfs.map(async (symbol) => {
        try {
          const [quote, chart] = await Promise.all([
            yahooFinance.quote(symbol),
            yahooFinance.chart(symbol, { period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), interval: '1d' }),
          ]);
          const quotes = chart && chart.quotes ? chart.quotes : [];
          const recent = quotes
            .filter(function (d) {
              return d.volume && d.volume > 0;
            })
            .sort(function (a, b) {
              return new Date(b.date) - new Date(a.date);
            })
            .slice(0, 10);
          const avgVol =
            recent.length >= 3
              ? Math.round(
                  recent.reduce(function (s, d) {
                    return s + d.volume;
                  }, 0) / recent.length
                )
              : 0;

          let vol = quote.regularMarketVolume || 0;
          let change = quote.regularMarketChangePercent || 0;
          let price = quote.regularMarketPrice || 0;
          let dayHigh = quote.regularMarketDayHigh || 0;
          let dayLow = quote.regularMarketDayLow || 0;
          let prevClose = quote.regularMarketPreviousClose || 0;
          let lastSession = false;

          // If market is closed (no live volume), fall back to the most recent session's data
          if (vol === 0 && recent.length > 0) {
            const last = recent[0];
            vol = last.volume || 0;
            price = last.close || price;
            dayHigh = last.high || dayHigh;
            dayLow = last.low || dayLow;
            // Compute change from last two sessions if Yahoo isn't providing it
            if (change === 0 && recent.length >= 2) {
              const prev = recent[1].close;
              if (prev > 0) change = ((last.close - prev) / prev) * 100;
            }
            lastSession = true;
          }

          try {
            const fRes = await finnhubFetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol));
            const fData = fRes ? await fRes.json() : null;
            if (fData && fData.c && fData.c > 0 && !fData.error) {
              price = fData.c;
              change = fData.dp || change;
              dayHigh = fData.h || dayHigh;
              dayLow = fData.l || dayLow;
              prevClose = fData.pc || prevClose;
            }
          } catch (e) {}

          const volRatio = avgVol > 0 ? Math.round((vol / avgVol) * 100) / 100 : 0;
          let flow = 'neutral';
          if (change > 0.3 && volRatio > 1.1) flow = 'inflow';
          else if (change < -0.3 && volRatio > 1.1) flow = 'outflow';

          return {
            symbol: symbol,
            price: price,
            change: Math.round(change * 100) / 100,
            volume: vol,
            avgVolume: avgVol,
            volRatio: volRatio,
            flow: flow,
            dayHigh: dayHigh,
            dayLow: dayLow,
            prevClose: prevClose,
            lastSession: lastSession,
          };
        } catch (e) {
          return {
            symbol: symbol,
            price: 0,
            change: 0,
            volume: 0,
            avgVolume: 0,
            volRatio: 0,
            flow: 'neutral',
            dayHigh: 0,
            dayLow: 0,
            prevClose: 0,
            lastSession: false,
          };
        }
      })
    );
    await spendScan(req.user, 'sectorMoving');
    var fetchTime = new Date().toISOString();
    flowCache = { results: results, fetchTime: fetchTime, expiresAt: Date.now() + CACHE_TTL_MS };
    res.json({ results: results, fetchTime: fetchTime, ...quotaFor(req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
