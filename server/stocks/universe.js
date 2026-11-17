const { SP500, NASDAQ100, ALL_TICKERS } = require('../../tickers');

// Stock pages cover the app's own scan universe: the S&P 500 and the
// Nasdaq-100 (every sector list in the app is a subset of these).
const SYMBOLS = Object.freeze([...ALL_TICKERS]);
const SP500_SET = new Set(SP500);
const NASDAQ100_SET = new Set(NASDAQ100);

function slugFor(symbol) {
  return symbol.toLowerCase().replace(/\./g, '-');
}

const BY_SLUG = new Map(SYMBOLS.map((symbol) => [slugFor(symbol), symbol]));

function symbolForSlug(slug) {
  return BY_SLUG.get(String(slug).toLowerCase()) || null;
}

function indexesFor(symbol) {
  const out = [];
  if (SP500_SET.has(symbol)) out.push('S&P 500');
  if (NASDAQ100_SET.has(symbol)) out.push('Nasdaq-100');
  return out;
}

module.exports = { SYMBOLS, slugFor, symbolForSlug, indexesFor };
