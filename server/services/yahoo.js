const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  // Yahoo's undocumented API occasionally returns fields that don't match the
  // library's schema (e.g. delisted/misspelt tickers). The library still
  // returns usable data and callers already handle errors — this only
  // silences the multi-paragraph console dump per occurrence.
  validation: { logErrors: false, logOptionsErrors: false },
});

module.exports = yahooFinance;
