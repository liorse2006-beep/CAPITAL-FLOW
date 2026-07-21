const { ALPHA_VANTAGE_API_KEY } = require('../config');

const API_BASE = 'https://www.alphavantage.co/query';

// Free tier is ~25 requests/day — this is a last-resort fallback for the
// small watchlist-quotes endpoint only, never the bulk scanner. Capping
// internal usage well under the real quota leaves headroom for other days.
const DAILY_CALL_CAP = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // symbol -> { data, fetchedAt }
let callCount = 0;
let callCountDate = null;

function withinDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (callCountDate !== today) {
    callCountDate = today;
    callCount = 0;
  }
  return callCount < DAILY_CALL_CAP;
}

/** Fetches one quote from Alpha Vantage's GLOBAL_QUOTE endpoint. Never
 * throws — returns null on any failure, missing key, cap, or rate limit
 * (Alpha Vantage signals throttling via a "Note"/"Information" field in a
 * 200 response, not an HTTP error status). */
async function fetchQuote(symbol) {
  if (!ALPHA_VANTAGE_API_KEY) return null;

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  if (!withinDailyCap()) return null;

  try {
    callCount++;
    const url = `${API_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.Note || data.Information) return null;

    const q = data['Global Quote'];
    if (!q || !q['05. price']) return null;

    const price = parseFloat(q['05. price']);
    const prevClose = parseFloat(q['08. previous close']);
    const volume = parseInt(q['06. volume'], 10);
    if (!price || !volume) return null;

    const result = {
      symbol: q['01. symbol'] || symbol,
      price,
      change: prevClose > 0 ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : 0,
      volume,
      prevClose: prevClose || 0,
    };
    cache.set(symbol, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (e) {
    return null;
  }
}

module.exports = { fetchQuote };
