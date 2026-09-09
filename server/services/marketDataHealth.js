const quoteCache = require('./quoteCache');
const finnhub = require('./finnhub');

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

  let finnhubQuote = null;
  let finnhubMetric = null;
  try {
    [finnhubQuote, finnhubMetric] = await Promise.all([
      finnhub.fetchFinnhubQuote('AAPL'),
      finnhub.fetchFinnhubMetric('AAPL'),
    ]);
  } catch (_) {
    // The individual provider helpers already fail closed; keep this final
    // guard so a future helper change cannot make the status route fail open.
  }
  const finnhubStatus =
    finnhubQuote && finnhubMetric ? 'complete' : finnhubQuote || finnhubMetric ? 'partial' : 'unavailable';
  const normalizedFullScan = normalizeFullScan(fullScan);
  const warnings = [];

  if (yahooStatus !== 'complete') {
    warnings.push(
      `Yahoo quote coverage is ${yahooStatus}: ${availableSymbols.length}/${MARKET_DATA_PROBE_SYMBOLS.length} probe symbols verified.`
    );
  }
  if (finnhubStatus !== 'complete') {
    warnings.push(`Finnhub enrichment status is ${finnhubStatus}.`);
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
    provider: 'Yahoo Finance + Finnhub',
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
      finnhub: { status: finnhubStatus },
    },
    fullScan: normalizedFullScan,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  };
}

module.exports = { MARKET_DATA_PROBE_SYMBOLS, hasRequiredScanQuote, normalizeFullScan, probeMarketData };
