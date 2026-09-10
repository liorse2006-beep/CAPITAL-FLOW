const quoteCache = require('./quoteCache');
const finnhub = require('./finnhub');
const massive = require('./massive');

// A small, stable probe set keeps the status check cheap while covering the
// same quote fields the scanners require. AVB is intentionally included as a
// representative edge symbol because a single liquid ticker such as AAPL is
// not evidence that the full universe is available.
const MARKET_DATA_PROBE_SYMBOLS = Object.freeze(['AAPL', 'MSFT', 'NVDA', 'JPM', 'XOM', 'AVB']);

function normalizedSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function hasRequiredScanQuote(row) {
  return (
    Number(row?.regularMarketPrice) > 0 &&
    Number(row?.regularMarketVolume) > 0 &&
    Number(row?.averageDailyVolume10Day) > 0 &&
    Number(row?.marketCap) > 0
  );
}

function hasRequiredFinnhubQuote(row) {
  return Number(row?.price) > 0;
}

function hasRequiredFinnhubMetric(row) {
  // These are the two metric fields the scanner can actually use when Yahoo
  // omits a slow daily field. An object with only null fields is not provider
  // coverage and must not make the health check look complete.
  return Number(row?.marketCap) > 0 && Number(row?.avgVol10d) > 0;
}

function hasRequiredMassiveMetric(row) {
  return (
    Number(row?.marketCap) > 0 &&
    Number(row?.avgVol10d) > 0 &&
    typeof row?.dataAsOf === 'string' &&
    typeof row?.referenceAsOf === 'string'
  );
}

function normalizeFullScan(fullScan) {
  if (!fullScan || typeof fullScan !== 'object') return null;
  const requestedSymbols = Number(fullScan.requestedSymbols);
  const verifiedSymbols = Number(fullScan.verifiedSymbols);
  const missingSymbols = Number(fullScan.missingSymbols);
  const status = String(fullScan.dataStatus || '').toLowerCase();
  if (!Number.isFinite(requestedSymbols) || requestedSymbols <= 0 || !Number.isFinite(verifiedSymbols)) return null;
  return {
    status: ['complete', 'partial', 'unavailable'].includes(status) ? status : 'unknown',
    requestedSymbols,
    verifiedSymbols: Math.max(0, verifiedSymbols),
    missingSymbols: Number.isFinite(missingSymbols) ? Math.max(0, missingSymbols) : null,
    coveragePercent: Number(((Math.max(0, verifiedSymbols) / requestedSymbols) * 100).toFixed(2)),
    scanTime: fullScan.scanTime || null,
    dataAsOf: fullScan.dataAsOf || null,
  };
}

function coverageStatus(available, requested, providerFailure, staleCount) {
  if (available === 0 || providerFailure) return 'unavailable';
  if (available < requested || staleCount > 0) return 'partial';
  return 'complete';
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (_) {
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

async function probeMarketData({ fullScan } = {}) {
  let quotes = new Map();
  let quoteProbeError = null;
  try {
    quotes = await quoteCache.getQuotes(MARKET_DATA_PROBE_SYMBOLS);
  } catch (error) {
    quoteProbeError = error?.name || 'Error';
  }

  const availableSymbols = MARKET_DATA_PROBE_SYMBOLS.filter((symbol) =>
    hasRequiredScanQuote(quotes?.get(normalizedSymbol(symbol)))
  );
  const staleSymbols = Array.isArray(quotes?.staleSymbols)
    ? quotes.staleSymbols.map(normalizedSymbol).filter(Boolean)
    : [];
  const yahooStatus = coverageStatus(
    availableSymbols.length,
    MARKET_DATA_PROBE_SYMBOLS.length,
    quoteProbeError || quotes?.providerFailure === true,
    staleSymbols.length
  );

  const finnhubProbe = await mapWithConcurrency(MARKET_DATA_PROBE_SYMBOLS, 3, async (symbol) => {
    const [quote, metric] = await Promise.all([finnhub.fetchFinnhubQuote(symbol), finnhub.fetchFinnhubMetric(symbol)]);
    return {
      symbol,
      quoteOk: hasRequiredFinnhubQuote(quote),
      metricOk: hasRequiredFinnhubMetric(metric),
    };
  });
  const finnhubQuoteSymbols = finnhubProbe.filter((row) => row?.quoteOk).length;
  const finnhubMetricSymbols = finnhubProbe.filter((row) => row?.metricOk).length;
  const finnhubVerifiedSymbols = finnhubProbe.filter((row) => row?.quoteOk && row?.metricOk).length;
  const finnhubStatus = coverageStatus(finnhubVerifiedSymbols, MARKET_DATA_PROBE_SYMBOLS.length, false, 0);
  const massiveConfigured = massive.isConfigured();
  const massiveProbe = massiveConfigured
    ? await mapWithConcurrency(MARKET_DATA_PROBE_SYMBOLS, 3, async (symbol) => ({
        symbol,
        metric: await massive.fetchMassiveMetrics(symbol),
      }))
    : [];
  const massiveVerifiedSymbols = massiveProbe.filter((row) => hasRequiredMassiveMetric(row?.metric)).length;
  const massiveStatus = massiveConfigured
    ? coverageStatus(massiveVerifiedSymbols, MARKET_DATA_PROBE_SYMBOLS.length, false, 0)
    : 'not_configured';
  const normalizedFullScan = normalizeFullScan(fullScan);
  const warnings = [];

  if (yahooStatus !== 'complete') {
    warnings.push(
      `Yahoo quote coverage is ${yahooStatus}: ${availableSymbols.length}/${MARKET_DATA_PROBE_SYMBOLS.length} probe symbols verified.`
    );
  }
  if (finnhubStatus !== 'complete') {
    warnings.push(
      `Finnhub required-field coverage is ${finnhubStatus}: ${finnhubVerifiedSymbols}/${MARKET_DATA_PROBE_SYMBOLS.length} probe symbols verified (quotes ${finnhubQuoteSymbols}/${MARKET_DATA_PROBE_SYMBOLS.length}, metrics ${finnhubMetricSymbols}/${MARKET_DATA_PROBE_SYMBOLS.length}).`
    );
  }
  if (massiveConfigured && massiveStatus !== 'complete') {
    warnings.push(
      `Massive required-field coverage is ${massiveStatus}: ${massiveVerifiedSymbols}/${MARKET_DATA_PROBE_SYMBOLS.length} probe symbols verified.`
    );
  }
  if (!normalizedFullScan) {
    warnings.push('Full-universe scan coverage has not been recorded yet.');
  } else if (normalizedFullScan.status !== 'complete') {
    warnings.push(
      `The last full-universe scan verified ${normalizedFullScan.verifiedSymbols}/${normalizedFullScan.requestedSymbols} symbols.`
    );
  }

  const overallStatus = yahooStatus === 'unavailable' ? 'unavailable' : warnings.length > 0 ? 'partial' : 'complete';
  const sampleSymbol = availableSymbols[0] || null;
  const sample = sampleSymbol
    ? {
        symbol: sampleSymbol,
        price: Number(quotes.get(sampleSymbol)?.regularMarketPrice) || null,
      }
    : null;

  return {
    ok: overallStatus !== 'unavailable' && sample !== null,
    status: overallStatus,
    provider: 'Yahoo Finance + Finnhub + Massive',
    sample,
    dataAsOf: quotes?.dataAsOf || null,
    coverage: {
      probeSymbols: MARKET_DATA_PROBE_SYMBOLS.length,
      verifiedProbeSymbols: availableSymbols.length,
      missingProbeSymbols: MARKET_DATA_PROBE_SYMBOLS.length - availableSymbols.length,
      staleProbeSymbols: staleSymbols.length,
      status: yahooStatus,
    },
    providers: {
      yahoo: { status: yahooStatus },
      finnhub: {
        status: finnhubStatus,
        coverage: {
          probeSymbols: MARKET_DATA_PROBE_SYMBOLS.length,
          verifiedSymbols: finnhubVerifiedSymbols,
          missingSymbols: MARKET_DATA_PROBE_SYMBOLS.length - finnhubVerifiedSymbols,
          verifiedQuoteSymbols: finnhubQuoteSymbols,
          verifiedMetricSymbols: finnhubMetricSymbols,
        },
      },
      massive: {
        configured: massiveConfigured,
        status: massiveStatus,
        capability: 'delayed daily metrics only',
        coverage: {
          probeSymbols: MARKET_DATA_PROBE_SYMBOLS.length,
          verifiedSymbols: massiveVerifiedSymbols,
          missingSymbols: MARKET_DATA_PROBE_SYMBOLS.length - massiveVerifiedSymbols,
        },
      },
    },
    fullScan: normalizedFullScan,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  };
}

module.exports = {
  MARKET_DATA_PROBE_SYMBOLS,
  hasRequiredScanQuote,
  hasRequiredFinnhubQuote,
  hasRequiredFinnhubMetric,
  hasRequiredMassiveMetric,
  normalizeFullScan,
  probeMarketData,
};
