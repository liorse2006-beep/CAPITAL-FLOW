const router = require('express').Router();
const yahooFinance = require('../services/yahoo');
const { finnhubFetch } = require('../services/finnhub');
const { requireScanQuota } = require('../middleware/authMiddleware');
const { refundScan, quotaFor } = require('../services/scanQuota');
const { reportError } = require('../utils/reportError');

// Sector-flow has no per-user params — every caller gets the same 15 ETFs —
// so a short shared cache turns N concurrent requests into 1 upstream fetch.
var flowCache = { results: null, fetchTime: null, dataStatus: null, dataAsOf: null, expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundOrNull(value, digits) {
  const number = finiteOrNull(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

router.get('/sector-flow', requireScanQuota('sectorMoving'), async (req, res) => {
  if (flowCache.results && flowCache.expiresAt > Date.now()) {
    // Cache hit — free, same policy as the main scanner. requireScanQuota
    // already reserved a slot before we knew this would be a cache hit —
    // refund it.
    await refundScan(req.user, req.scanReservation);
    return res.json({
      results: flowCache.results,
      fetchTime: flowCache.fetchTime,
      dataStatus: flowCache.dataStatus,
      dataAsOf: flowCache.dataAsOf,
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
    // One batched Yahoo call for all 15 ETFs instead of 15 individual quote
    // calls — yahoo-finance2 supports array input the same way quoteCache.js
    // already relies on elsewhere. Same data, same freshness (still fetched
    // fresh on every cache-miss cycle), just one round-trip instead of 15. A
    // symbol missing from the batch response (or the whole call failing)
    // falls through to the existing "market closed / no quote" chart-based
    // fallback below, unchanged from today's per-symbol failure handling.
    const quoteMap = new Map();
    try {
      const batchQuotes = await yahooFinance.quote(etfs);
      (Array.isArray(batchQuotes) ? batchQuotes : [batchQuotes]).forEach((q) => {
        if (q && q.symbol) quoteMap.set(q.symbol, q);
      });
    } catch (e) {
      // Leave quoteMap empty — each symbol's existing fallback path handles this.
    }

    const results = await Promise.all(
      etfs.map(async (symbol) => {
        try {
          const quote = quoteMap.get(symbol) || {};
          const chart = await yahooFinance.chart(symbol, {
            period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
            interval: '1d',
          });
          const quotes = chart && chart.quotes ? chart.quotes : [];
          const recent = quotes
            .filter(function (d) {
              return finiteOrNull(d.volume) !== null && finiteOrNull(d.volume) > 0 && finiteOrNull(d.close) !== null;
            })
            .sort(function (a, b) {
              return new Date(b.date) - new Date(a.date);
            })
            .slice(0, 10);
          const avgVol =
            recent.length >= 3
              ? Math.round(
                  recent.reduce(function (s, d) {
                    return s + Number(d.volume);
                  }, 0) / recent.length
                )
              : null;

          let vol = finiteOrNull(quote.regularMarketVolume);
          let change = finiteOrNull(quote.regularMarketChangePercent);
          let price = finiteOrNull(quote.regularMarketPrice);
          let dayHigh = finiteOrNull(quote.regularMarketDayHigh);
          let dayLow = finiteOrNull(quote.regularMarketDayLow);
          let prevClose = finiteOrNull(quote.regularMarketPreviousClose);
          let lastSession = false;

          // If market is closed (no live volume), fall back to the most recent session's data
          if ((!vol || vol <= 0) && recent.length > 0) {
            const last = recent[0];
            vol = finiteOrNull(last.volume);
            price = finiteOrNull(last.close) ?? price;
            dayHigh = finiteOrNull(last.high) ?? dayHigh;
            dayLow = finiteOrNull(last.low) ?? dayLow;
            // Compute change from last two sessions if Yahoo isn't providing it
            if (change === null && recent.length >= 2) {
              const previous = finiteOrNull(recent[1].close);
              const close = finiteOrNull(last.close);
              if (previous > 0 && close !== null) change = ((close - previous) / previous) * 100;
            }
            lastSession = true;
          }

          try {
            const fRes = await finnhubFetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol));
            const fData = fRes ? await fRes.json() : null;
            const finnhubPrice = finiteOrNull(fData && fData.c);
            if (fData && finnhubPrice !== null && finnhubPrice > 0 && !fData.error) {
              price = finnhubPrice;
              change = finiteOrNull(fData.dp) ?? change;
              dayHigh = finiteOrNull(fData.h) ?? dayHigh;
              dayLow = finiteOrNull(fData.l) ?? dayLow;
              prevClose = finiteOrNull(fData.pc) ?? prevClose;
            }
          } catch (e) {}

          const volRatio = avgVol > 0 && vol > 0 ? roundOrNull(vol / avgVol, 2) : null;
          const dataStatus = price > 0 && vol > 0 && avgVol > 0 ? 'complete' : 'unavailable';
          let flow = 'unavailable';
          if (dataStatus === 'complete') {
            flow = 'neutral';
            if (change !== null && change > 0.3 && volRatio > 1.1) flow = 'inflow';
            else if (change !== null && change < -0.3 && volRatio > 1.1) flow = 'outflow';
          }

          return {
            symbol: symbol,
            price: price,
            change: roundOrNull(change, 2),
            volume: vol,
            avgVolume: avgVol,
            volRatio: volRatio,
            flow: flow,
            dayHigh: dayHigh,
            dayLow: dayLow,
            prevClose: prevClose,
            lastSession: lastSession,
            dataStatus: dataStatus,
          };
        } catch (e) {
          return {
            symbol: symbol,
            price: null,
            change: null,
            volume: null,
            avgVolume: null,
            volRatio: null,
            flow: 'unavailable',
            dayHigh: null,
            dayLow: null,
            prevClose: null,
            lastSession: false,
            dataStatus: 'unavailable',
          };
        }
      })
    );
    var fetchTime = new Date().toISOString();
    const unavailableCount = results.filter((result) => result.dataStatus === 'unavailable').length;
    const dataStatus =
      unavailableCount === results.length ? 'unavailable' : unavailableCount > 0 ? 'partial' : 'complete';
    flowCache = {
      results: results,
      fetchTime: fetchTime,
      dataStatus: dataStatus,
      dataAsOf: fetchTime,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    res.json({ results: results, fetchTime: fetchTime, dataStatus, dataAsOf: fetchTime, ...quotaFor(req.user) });
  } catch (err) {
    await refundScan(req.user, req.scanReservation);
    reportError(err, '[sectors]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
