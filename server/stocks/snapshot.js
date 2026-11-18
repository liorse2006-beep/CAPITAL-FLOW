// Daily snapshot job for the public stock pages.
//
// Once per completed U.S. trading session, a single background task fetches
// quote, chart, profile and fundamentals data for every symbol in the
// universe and stores one JSON row per symbol. Pages are rendered only from
// these rows, so a crawler visiting 500 pages never triggers a provider call.
// The job is deliberately slow (small chunks with pauses) to stay well inside
// provider rate limits and the instance's CPU budget, and it resumes where it
// stopped if the process restarts mid-run.
const db = require('../db');
const yahoo = require('../services/yahoo');
const { scanFundamentals } = require('../services/fundamentalsScanner');
const { latestCompletedSessionDate, newYorkParts, sessionDateForTimestamp } = require('../services/marketCalendar');
const { reportError } = require('../utils/reportError');
const { SYMBOLS } = require('./universe');
const { ETF_SYMBOLS, etfMeta } = require('./etfs');

const ALL_SYMBOLS = Object.freeze([...SYMBOLS, ...ETF_SYMBOLS]);

const CHUNK_SIZE = 5;
const PAUSE_MS = 4000;
const PROFILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_DELAY_MS = 3 * 60 * 1000;
// Run no earlier than 90 minutes after the 16:00 ET close, so closing prints
// and daily bars have settled at the providers.
const EARLIEST_RUN_MINUTES_ET = 17 * 60 + 30;

// Yahoo writes class shares with a hyphen (BRK-B); the app and Finnhub use a
// dot (BRK.B). Translate only at the Yahoo boundary, like quoteCache does.
const toYahoo = (symbol) => symbol.replace(/\./g, '-');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

// Simple moving averages from daily closes; `previous150` is the 150-day
// average as it stood 20 sessions ago, used only to describe the slope.
function movingAverages(closes) {
  const last = (n, offset = 0) =>
    closes.length >= n + offset ? closes.slice(closes.length - n - offset, closes.length - offset) : null;
  const window = (n, offset) => {
    const values = last(n, offset);
    return values ? average(values) : null;
  };
  return { sma20: window(20, 0), sma50: window(50, 0), sma150: window(150, 0), sma150Prev20: window(150, 20) };
}

// One bad symbol must not drop its whole chunk: if the batch request fails,
// fall back to one request per symbol.
async function fetchQuotes(symbols) {
  try {
    const rows = await yahoo.quote(symbols.map(toYahoo));
    return Array.isArray(rows) ? rows : [rows];
  } catch {
    const rows = await Promise.all(symbols.map((symbol) => yahoo.quote(toYahoo(symbol)).catch(() => null)));
    return rows.filter(Boolean);
  }
}

// Daily bars up to and including the given completed session. Price, change
// and volume come from these bars rather than from the live quote, so the job
// can run at any hour (including during trading) and the stored price is
// always a real closing price for a finished session, never an intraday tick.
async function fetchSessionBars(symbol, session) {
  const period1 = new Date(Date.now() - 270 * 24 * 60 * 60 * 1000);
  const chart = await yahoo.chart(toYahoo(symbol), { period1, interval: '1d' });
  return (chart.quotes || [])
    .map((bar) => ({ day: sessionDateForTimestamp(bar.date), close: finite(bar.close), volume: finite(bar.volume) }))
    .filter((bar) => bar.day && bar.close !== null && bar.day <= session);
}

async function fetchProfile(symbol) {
  const summary = await yahoo.quoteSummary(toYahoo(symbol), { modules: ['assetProfile'] });
  const profile = summary.assetProfile || {};
  return {
    sector: profile.sector || null,
    industry: profile.industry || null,
    city: profile.city || null,
    state: profile.state || null,
    country: profile.country || null,
    employees: finite(profile.fullTimeEmployees),
    profileAt: Date.now(),
  };
}

// ETF facts: top holdings with weights, expense ratio, assets and yield.
async function fetchFundProfile(symbol) {
  const summary = await yahoo.quoteSummary(toYahoo(symbol), {
    modules: ['topHoldings', 'fundProfile', 'summaryDetail'],
  });
  const top = summary.topHoldings || {};
  const fund = summary.fundProfile || {};
  const detail = summary.summaryDetail || {};
  return {
    holdings: (top.holdings || [])
      .map((h) => ({
        symbol: h.symbol ? String(h.symbol).replace(/-/g, '.') : null,
        name: h.holdingName || null,
        weight: finite(h.holdingPercent),
      }))
      .filter((h) => (h.symbol || h.name) && h.weight !== null)
      .slice(0, 10),
    family: fund.family || null,
    category: fund.categoryName || null,
    expenseRatio: finite(fund.feesExpensesInvestment && fund.feesExpensesInvestment.annualReportExpenseRatio),
    totalAssets: finite(detail.totalAssets),
    yield: finite(detail.yield),
    profileAt: Date.now(),
  };
}

async function loadExisting(symbols) {
  const placeholders = symbols.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT symbol, data FROM stock_snapshots WHERE symbol IN (${placeholders})`)
    .all(...symbols);
  const out = new Map();
  for (const row of rows) {
    try {
      out.set(row.symbol, JSON.parse(row.data));
    } catch {
      // A corrupt row is simply rebuilt.
    }
  }
  return out;
}

async function saveSnapshot(symbol, data) {
  await db
    .prepare(
      `INSERT INTO stock_snapshots (symbol, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .run(symbol, JSON.stringify(data), Math.floor(Date.now() / 1000));
}

// Builds a snapshot for one chunk. A field a provider did not report is
// stored as null and rendered as "not available"; nothing is estimated.
async function buildChunk(symbols, session, existing) {
  const stockSymbols = symbols.filter((symbol) => !etfMeta(symbol));
  const [quotes, fundamentals] = await Promise.all([
    fetchQuotes(symbols),
    stockSymbols.length ? scanFundamentals(stockSymbols).catch(() => ({ results: [] })) : { results: [] },
  ]);
  const quoteBySymbol = new Map(quotes.filter(Boolean).map((q) => [String(q.symbol).replace(/-/g, '.'), q]));
  const fundBySymbol = new Map((fundamentals.results || []).map((f) => [f.symbol, f]));

  for (const symbol of symbols) {
    const quote = quoteBySymbol.get(symbol) || {};
    const previous = existing.get(symbol) || {};
    const fund = fundBySymbol.get(symbol) || {};
    let bars = [];
    try {
      bars = await fetchSessionBars(symbol, session);
    } catch {
      bars = [];
    }
    // Without a closing price there is nothing honest to show; the symbol is
    // retried on the next tick.
    if (!bars.length) continue;
    const last = bars[bars.length - 1];
    const prior = bars.length > 1 ? bars[bars.length - 2] : null;
    const closes = bars.map((bar) => bar.close);
    const isEtf = !!etfMeta(symbol);
    let profile = previous.profileAt && Date.now() - previous.profileAt < PROFILE_MAX_AGE_MS ? previous : null;
    if (!profile) profile = await (isEtf ? fetchFundProfile(symbol) : fetchProfile(symbol)).catch(() => previous);

    const market = {
      symbol,
      session,
      asOf: Date.now(),
      priceDate: last.day,
      name: quote.longName || quote.shortName || previous.name || symbol,
      price: last.close,
      changePct: prior ? (last.close / prior.close - 1) * 100 : null,
      volume: last.volume,
      avgVolume3m: finite(quote.averageDailyVolume3Month),
      high52: finite(quote.fiftyTwoWeekHigh),
      low52: finite(quote.fiftyTwoWeekLow),
      ...movingAverages(closes),
    };
    if (isEtf) {
      await saveSnapshot(symbol, {
        ...market,
        kind: 'etf',
        holdings: profile.holdings || [],
        family: profile.family || null,
        category: profile.category || null,
        expenseRatio: profile.expenseRatio ?? null,
        totalAssets: profile.totalAssets ?? null,
        yield: profile.yield ?? null,
        profileAt: profile.profileAt || null,
      });
      continue;
    }

    const verified = (key) => (fund.unverified && fund.unverified[key] ? null : finite(fund[key]));
    await saveSnapshot(symbol, {
      ...market,
      kind: 'stock',
      marketCap: finite(quote.marketCap) ?? previous.marketCap ?? null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      city: profile.city || null,
      state: profile.state || null,
      country: profile.country || null,
      employees: profile.employees ?? null,
      profileAt: profile.profileAt || null,
      pe: verified('peRatio'),
      forwardPE: verified('forwardPE'),
      peg: verified('pegRatio'),
      debtToEquity: verified('debtToEquity'),
      revenueGrowth5Y: verified('revenueGrowth5Y'),
      floatShares: verified('floatShares'),
      shortPercent: verified('shortPercent'),
      nextEarningsDate: fund.unverified && fund.unverified.nextEarningsDate ? null : fund.nextEarningsDate || null,
    });
  }
}

let running = false;

async function runSnapshotJob({
  session = latestCompletedSessionDate(),
  symbols = ALL_SYMBOLS,
  pauseMs = PAUSE_MS,
} = {}) {
  if (running) return { skipped: true };
  running = true;
  let processed = 0;
  try {
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      const existing = await loadExisting(chunk);
      const pending = chunk.filter((symbol) => (existing.get(symbol) || {}).session !== session);
      if (!pending.length) continue;
      try {
        await buildChunk(pending, session, existing);
        processed += pending.length;
      } catch (error) {
        reportError(error, '[stockSnapshots] chunk failed');
      }
      if (pauseMs) await sleep(pauseMs);
    }
    // The session counts as done only when every symbol has it. Until then each
    // tick retries just the missing symbols, so no page stays empty for long.
    let missing = 0;
    for (let i = 0; i < symbols.length; i += 100) {
      const stored = await loadExisting(symbols.slice(i, i + 100));
      missing += symbols.slice(i, i + 100).filter((symbol) => (stored.get(symbol) || {}).session !== session).length;
    }
    if (missing === 0) {
      await db
        .prepare(
          `INSERT INTO app_meta (key, value) VALUES ('stock_snapshot_session', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(session);
    }
    return { processed, missing, session };
  } finally {
    running = false;
  }
}

async function snapshotDue(now = new Date()) {
  const session = latestCompletedSessionDate(now);
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'stock_snapshot_session'").get();
  if (row && row.value === session) return null;
  // Same calendar day as the session: wait for the settle window after the
  // close. Any later day (weekend, holiday, a restart) can run immediately.
  const parts = newYorkParts(now);
  const todayEt = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  if (todayEt === session && parts.minutes < EARLIEST_RUN_MINUTES_ET) return null;
  return session;
}

function startStockSnapshots() {
  const { backgroundTimeout, backgroundInterval } = require('../services/backgroundRuntime');
  async function tick() {
    try {
      const session = await snapshotDue();
      if (session) await runSnapshotJob({ session });
    } catch (error) {
      reportError(error, '[stockSnapshots]');
    }
  }
  backgroundTimeout(tick, STARTUP_DELAY_MS);
  backgroundInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { runSnapshotJob, snapshotDue, startStockSnapshots, movingAverages };
