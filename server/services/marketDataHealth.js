const quoteCache = require('./quoteCache');
const finnhub = require('./finnhub');
const massive = require('./massive');
const { isMarketOpen, isPreMarket } = require('./marketCalendar');

// A small, stable probe set keeps the status check cheap while covering the
// same quote fields the scanners require. AVB is intentionally included as a
// representative edge symbol because a single liquid ticker such as AAPL is
// not evidence that the full universe is available.
const MARKET_DATA_PROBE_SYMBOLS = Object.freeze(['AAPL', 'MSFT', 'NVDA', 'JPM', 'XOM', 'AVB']);

function normalizedSymbol(value) {
  return (typeof value === 'string' ? value : '').trim().toUpperCase();
}

function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0;
}

function sourceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 5 * 60_000) return null;
  return new Date(timestamp).toISOString();
}

function hasRequiredScanQuote(row, expectedSymbol = row?.symbol) {
  return hasLiveScanQuote(row, expectedSymbol) && positive(row?.averageDailyVolume10Day) && positive(row?.marketCap);
}

function hasLiveScanQuote(row, expectedSymbol = row?.symbol) {
  return Boolean(
    normalizedSymbol(expectedSymbol) &&
    normalizedSymbol(row?.symbol) === normalizedSymbol(expectedSymbol) &&
    normalizedSymbol(row?.currency) === 'USD' &&
    !['unavailable', 'stale', 'unknown'].includes(row?.dataStatus) &&
    positive(row?.regularMarketPrice) &&
    positive(row?.regularMarketVolume) &&
    !quoteCache.isProviderTimestampStale(row)
  );
}

function hasRequiredFinnhubQuote(row) {
  return (
    positive(row?.price) &&
    row?.dataStatus === 'complete' &&
    sourceDate(row?.dataAsOf) !== null &&
    Date.now() - Date.parse(row.dataAsOf) <= 24 * 60 * 60_000
  );
}

function hasRequiredFinnhubMetric(row) {
  // These are the two metric fields the scanner can actually use when Yahoo
  // omits a slow daily field. An object with only null fields is not provider
  // coverage and must not make the health check look complete.
  return row?.dataStatus === 'complete' && positive(row?.marketCap) && positive(row?.avgVol10d);
}

function hasRequiredMassiveMetric(row) {
  return (
    positive(row?.marketCap) &&
    positive(row?.avgVol10d) &&
    sourceDate(row?.dataAsOf) !== null &&
    sourceDate(row?.referenceAsOf) !== null
  );
}

function normalizeFullScan(fullScan) {
  if (!fullScan || typeof fullScan !== 'object') return null;
  const requestedSymbols = finiteNumber(fullScan.requestedSymbols);
  const verifiedSymbols = finiteNumber(fullScan.verifiedSymbols);
  const missingSymbols = finiteNumber(fullScan.missingSymbols);
  if (
    !Number.isSafeInteger(requestedSymbols) ||
    requestedSymbols <= 0 ||
    !Number.isSafeInteger(verifiedSymbols) ||
    verifiedSymbols < 0 ||
    verifiedSymbols > requestedSymbols ||
    !Number.isSafeInteger(missingSymbols) ||
    missingSymbols < 0 ||
    verifiedSymbols + missingSymbols !== requestedSymbols
  )
    return null;
  let status = String(fullScan.dataStatus || '').toLowerCase();
  if (!['complete', 'partial', 'unavailable'].includes(status)) status = 'unknown';
  const scanTime = sourceDate(fullScan.scanTime);
  const dataAsOf = sourceDate(fullScan.dataAsOf);
  if (!scanTime || !dataAsOf || quoteCache.isProviderTimestampStale({ regularMarketTime: dataAsOf }))
    status = 'unknown';
  else if (status === 'complete' && verifiedSymbols !== requestedSymbols) status = 'partial';
  else if (status === 'unavailable' && verifiedSymbols !== 0) status = 'unknown';
  return {
    status,
    requestedSymbols,
    verifiedSymbols,
    missingSymbols,
    coveragePercent: Number(((verifiedSymbols / requestedSymbols) * 100).toFixed(2)),
    scanTime,
    dataAsOf,
  };
}

function coverageStatus(available, requested, providerFailure, staleCount) {
  if (available === 0) return 'unavailable';
  if (providerFailure || available < requested || staleCount > 0) return 'partial';
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
    if (!(quotes instanceof Map)) throw new Error('Invalid quote probe response');
  } catch (error) {
    quoteProbeError = error?.name || 'Error';
    quotes = new Map();
  }

  const liveQuoteSymbols = MARKET_DATA_PROBE_SYMBOLS.filter((symbol) => hasLiveScanQuote(quotes.get(symbol), symbol));
  const completeQuoteSymbols = MARKET_DATA_PROBE_SYMBOLS.filter((symbol) =>
    hasRequiredScanQuote(quotes.get(symbol), symbol)
  );
  const staleSymbols = Array.isArray(quotes?.staleSymbols)
    ? [
        ...new Set(
          quotes.staleSymbols.map(normalizedSymbol).filter((symbol) => MARKET_DATA_PROBE_SYMBOLS.includes(symbol))
        ),
      ]
    : [];
  const yahooStatus = coverageStatus(
    liveQuoteSymbols.length,
    MARKET_DATA_PROBE_SYMBOLS.length,
    quoteProbeError || quotes?.providerFailure === true,
    staleSymbols.length
  );
  const fallbackProvider = quotes?.fallbackProvider || null;

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
  const finnhubMetricSymbolsByName = new Set(
    finnhubProbe.filter((row) => row?.metricOk).map((row) => normalizedSymbol(row.symbol))
  );
  const massiveMetricSymbolsByName = new Set(
    massiveProbe.filter((row) => hasRequiredMassiveMetric(row?.metric)).map((row) => normalizedSymbol(row.symbol))
  );
  const verifiedScanSymbols = MARKET_DATA_PROBE_SYMBOLS.filter((symbol) => {
    const row = quotes?.get(normalizedSymbol(symbol));
    return (
      hasLiveScanQuote(row, symbol) &&
      (hasRequiredScanQuote(row, symbol) ||
        finnhubMetricSymbolsByName.has(normalizedSymbol(symbol)) ||
        massiveMetricSymbolsByName.has(normalizedSymbol(symbol)))
    );
  });
  const warnings = [];

  if (yahooStatus !== 'complete') {
    warnings.push(
      `Yahoo quote coverage is ${yahooStatus}: ${liveQuoteSymbols.length}/${MARKET_DATA_PROBE_SYMBOLS.length} probe symbols verified.`
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
  if (verifiedScanSymbols.length < liveQuoteSymbols.length) {
    warnings.push(
      `Verified scan-field coverage is ${verifiedScanSymbols.length}/${liveQuoteSymbols.length} live quote symbols.`
    );
  }
  // The background worker intentionally does not start while the US market is
  // closed. Missing full-universe coverage is therefore expected off-hours;
  // during a market session it remains a real warning until a verified scan
  // completes.
  const sessionExpected = isMarketOpen() || isPreMarket();
  if (!normalizedFullScan && sessionExpected) {
    warnings.push('Full-universe scan coverage has not been recorded yet.');
  } else if (normalizedFullScan && normalizedFullScan.status !== 'complete') {
    warnings.push(
      `The last full-universe scan verified ${normalizedFullScan.verifiedSymbols}/${normalizedFullScan.requestedSymbols} symbols.`
    );
  }

  const overallStatus = verifiedScanSymbols.length === 0 ? 'unavailable' : warnings.length > 0 ? 'partial' : 'complete';
  const sampleSymbol = verifiedScanSymbols[0] || null;
  const sample = sampleSymbol
    ? {
        symbol: sampleSymbol,
        price: Number(quotes.get(sampleSymbol)?.regularMarketPrice) || null,
      }
    : null;

  return {
    ok: overallStatus !== 'unavailable' && sample !== null,
    status: overallStatus,
    provider: fallbackProvider ? `${fallbackProvider} + Finnhub + Massive` : 'Yahoo Finance + Finnhub + Massive',
    sample,
    fallbackProvider,
    dataAsOf:
      verifiedScanSymbols.length > 0
        ? new Date(
            Math.min(...verifiedScanSymbols.map((symbol) => quoteCache.providerTimestampMs(quotes.get(symbol))))
          ).toISOString()
        : null,
    coverage: {
      probeSymbols: MARKET_DATA_PROBE_SYMBOLS.length,
      verifiedProbeSymbols: verifiedScanSymbols.length,
      missingProbeSymbols: MARKET_DATA_PROBE_SYMBOLS.length - verifiedScanSymbols.length,
      liveQuoteSymbols: liveQuoteSymbols.length,
      completeQuoteSymbols: completeQuoteSymbols.length,
      staleProbeSymbols: staleSymbols.length,
      status: yahooStatus,
    },
    providers: {
      yahoo: {
        status: yahooStatus,
        mode: fallbackProvider ? 'fallback' : 'primary',
        provider: fallbackProvider || 'Yahoo Finance',
      },
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
  hasLiveScanQuote,
  hasRequiredFinnhubQuote,
  hasRequiredFinnhubMetric,
  hasRequiredMassiveMetric,
  normalizeFullScan,
  probeMarketData,
};
