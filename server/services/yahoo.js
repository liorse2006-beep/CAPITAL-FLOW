const YahooFinance = require('yahoo-finance2').default;
const { DEFAULT_TIMEOUT_MS } = require('../utils/fetchWithTimeout');

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  // Yahoo's undocumented API occasionally returns fields that don't match the
  // library's schema (e.g. delisted/misspelt tickers). The library still
  // returns usable data and callers already handle errors — this only
  // silences the multi-paragraph console dump per occurrence.
  validation: { logErrors: false, logOptionsErrors: false },
});

// Yahoo's client had no timeout at all — a single stalled connection could
// hang a request (and, via the shared scan lock, freeze the background
// scanner) indefinitely. Wrap the two methods this app actually calls
// (quote, chart) so every call gets a timeout signal unless the caller
// already passed one, without having to touch every call site.
function withTimeout(moduleOptions) {
  const opts = { ...(moduleOptions || {}) };
  if (!opts.fetchOptions || !opts.fetchOptions.signal) {
    opts.fetchOptions = { ...(opts.fetchOptions || {}), signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) };
  }
  return opts;
}

const originalQuote = yahooFinance.quote.bind(yahooFinance);
yahooFinance.quote = (query, queryOptions, moduleOptions) => originalQuote(query, queryOptions, withTimeout(moduleOptions));

const originalChart = yahooFinance.chart.bind(yahooFinance);
yahooFinance.chart = (symbol, queryOptions, moduleOptions) => originalChart(symbol, queryOptions, withTimeout(moduleOptions));

const originalQuoteSummary = yahooFinance.quoteSummary.bind(yahooFinance);
yahooFinance.quoteSummary = (symbol, queryOptions, moduleOptions) => originalQuoteSummary(symbol, queryOptions, withTimeout(moduleOptions));

module.exports = yahooFinance;
