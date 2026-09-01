import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError, formatPrice } from '../../utils/format';

const SYMBOL_RE = /^[A-Za-z0-9.-]{1,10}$/;

// Swing-trading fundamentals only — no institutional ownership, no
// multi-year balance-sheet detail. Just the handful of numbers that matter
// for a position measured in days-to-weeks: liquidity/squeeze setup (Float,
// Short %), valuation context (current P/E with an optional forward P/E and
// PEG), balance-sheet risk (Debt/Equity), a growth signal (5Y revenue
// growth), and the next volatility catalyst (earnings date). The customer
// picks which to see; the header (name/price/change/cap) is always-on baseline
// context.
//
// Each metric can carry a `hint(value)` — a short, plain-language read that
// turns a bare number into a swing-relevant signal (a high short interest,
// a negative growth trend, an earnings date days away). It's the difference
// between a spreadsheet and a tool.
// Each metric carries a small line-icon (react-free inline SVG path data) so
// the picker reads as a purpose-built control panel rather than a row of
// text tags — the icon gives every toggle a fixed visual anchor.
const ICONS = {
  float: 'M3 6h18M3 12h18M3 18h18',
  short: 'M3 7l6 6 4-4 8 8M21 17v-4h-4',
  pe: 'M12 3v18M5 8h14M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z',
  peg: 'M4 6h16M4 12h11M4 18h7M18 15l2 2 3-4',
  debt: 'M12 3v18M4 7h16M6 21h12M8 7l-2 7a2.5 2.5 0 0 0 5 0zM16 7l-2 7a2.5 2.5 0 0 0 5 0z',
  growth: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  earnings: 'M3 4h18v18H3zM3 10h18M8 2v4M16 2v4',
};

const SELECTABLE_METRICS = [
  { key: 'floatShares', label: 'Float', sub: 'Tradable shares', icon: ICONS.float, fmt: fmtShares, hint: hintFloat },
  {
    key: 'shortPercent',
    label: 'Short Interest',
    sub: '% of float',
    icon: ICONS.short,
    fmt: (v) => fmtPct(v * 100),
    hint: hintShort,
  },
  { key: 'peRatio', label: 'P/E Ratio', sub: 'Price / earnings', icon: ICONS.pe, fmt: fmtRatio, hint: hintPE },
  { key: 'pegRatio', label: 'PEG Ratio', sub: 'P/E / growth', icon: ICONS.peg, fmt: fmtRatio },
  {
    key: 'debtToEquity',
    label: 'Debt / Equity',
    sub: 'Balance-sheet risk',
    icon: ICONS.debt,
    fmt: fmtRatio,
    hint: hintDebt,
  },
  {
    key: 'revenueGrowth5Y',
    label: 'Revenue Growth',
    sub: '5-year average',
    icon: ICONS.growth,
    fmt: fmtGrowth,
    hint: hintGrowth,
    tone: toneGrowth,
  },
  {
    key: 'nextEarningsDate',
    label: 'Next Earnings',
    sub: 'Volatility catalyst',
    icon: ICONS.earnings,
    fmt: fmtEarnings,
    hint: hintEarnings,
  },
];
const ALL_METRIC_KEYS = SELECTABLE_METRICS.map((m) => m.key);

function MetricIcon({ path }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function fmtCap(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}
function fmtShares(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  v = Number(v);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}
function fmtPct(v) {
  return v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(1) + '%';
}
function fmtRatio(v) {
  return v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2);
}
// null (not reported) and 0% growth must stay visually distinguishable —
// never collapse "unknown" into "zero".
function fmtGrowth(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtEarnings(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Qualitative hints — plain-language, swing-relevant reads ────────────────
function hintFloat(v) {
  if (!v) return null;
  if (v < 20e6) return { text: 'Low float — moves fast', tone: 'warn' };
  if (v > 500e6) return { text: 'Very liquid', tone: 'muted' };
  return null;
}
function hintShort(v) {
  if (!v) return null;
  const pct = v * 100;
  if (pct >= 20) return { text: 'Heavily shorted — squeeze risk', tone: 'warn' };
  if (pct >= 10) return { text: 'Elevated short interest', tone: 'warn' };
  return null;
}
function hintPE(v) {
  if (!v) return null;
  if (v > 50) return { text: 'Richly valued', tone: 'warn' };
  if (v < 10) return { text: 'Low multiple', tone: 'muted' };
  return null;
}
function hintDebt(v) {
  if (!v) return null;
  if (v > 2) return { text: 'High leverage', tone: 'warn' };
  return null;
}
function hintGrowth(v) {
  if (v == null) return null;
  if (v < 0) return { text: 'Shrinking revenue', tone: 'bad' };
  if (v >= 20) return { text: 'Strong growth', tone: 'good' };
  return null;
}
function toneGrowth(v) {
  if (v == null) return null;
  return v >= 0 ? 'good' : 'bad';
}
function hintEarnings(v) {
  if (!v) return null;
  const days = Math.round((new Date(v + 'T00:00:00') - new Date()) / 86400000);
  if (days < 0) return null;
  if (days <= 7)
    return { text: 'In ' + days + ' day' + (days === 1 ? '' : 's') + ' — expect volatility', tone: 'warn' };
  if (days <= 21) return { text: 'In ' + days + ' days', tone: 'muted' };
  return null;
}

function ForwardMultiple({ result }) {
  const unverified = result.unverified && result.unverified.forwardPE;

  if (unverified) {
    return (
      <div className="fund-tile-secondary is-unverified">
        <span>Forward P/E</span>
        <span>Not verified — try again in a few minutes</span>
      </div>
    );
  }

  if (result.forwardPE == null) return null;

  return (
    <div className="fund-tile-secondary">
      <span>Forward P/E</span>
      <span>{fmtRatio(result.forwardPE)}</span>
    </div>
  );
}

// Quick-access chips for the last few tickers looked up — a device-local
// convenience, not app data, so plain localStorage is enough. Scoped per
// account (like the app's other per-user localStorage keys) so switching
// users on the same browser doesn't leak one customer's tickers to another.
const RECENT_KEY_PREFIX = 'vs_fund_recent:';
const MAX_RECENT = 5;

function loadRecentTickers(userId) {
  if (!userId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY_PREFIX + userId));
    return Array.isArray(raw) ? raw.slice(0, MAX_RECENT) : [];
  } catch (e) {
    return [];
  }
}
function saveRecentTicker(userId, symbol) {
  const next = [symbol, ...loadRecentTickers(userId).filter((s) => s !== symbol)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY_PREFIX + userId, JSON.stringify(next));
  } catch (e) {
    // localStorage unavailable/full — the chips are a convenience, not
    // required for the lookup itself, so just skip persisting silently.
  }
  return next;
}

function removeRecentTicker(userId, symbol) {
  const next = loadRecentTickers(userId).filter((ticker) => ticker !== symbol);
  try {
    localStorage.setItem(RECENT_KEY_PREFIX + userId, JSON.stringify(next));
  } catch (e) {
    // This is a convenience-only local preference. Keep the visible state
    // correct even when persistent browser storage is unavailable.
  }
  return next;
}

export default function FundamentalsPage({ onUpgrade, onSignIn, onCreateAccount }) {
  const { getToken, user } = useAuth();
  // Premium/Elite always; a free account also gets full (unlimited) access
  // for its 7-day trial — user.elite_access is the same server-computed
  // flag every other trial-widened feature reads (see server/routes/auth.js
  // and requirePremiumOrTrial), so this can't drift out of sync with the
  // backend's own gate on GET /api/fundamentals.
  const hasAccess = !!(user && (user.is_premium || user.elite_access));

  const [symbolInput, setSymbolInput] = useState('');
  // Starts with nothing selected — every toggle is off until the customer
  // actually picks one themselves, rather than defaulting to "everything
  // chosen" and making them deselect what they don't want.
  const [selectedMetrics, setSelectedMetrics] = useState(() => new Set());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [quoteDataStatus, setQuoteDataStatus] = useState(null);
  const [dataAsOf, setDataAsOf] = useState(null);
  const [recentTickers, setRecentTickers] = useState(() => loadRecentTickers(user && user.id));

  function toggleMetric(key) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const allSelected = selectedMetrics.size === ALL_METRIC_KEYS.length;
  function toggleAll() {
    setSelectedMetrics(allSelected ? new Set() : new Set(ALL_METRIC_KEYS));
  }

  async function lookupSymbol(symbol) {
    if (!user) {
      onSignIn();
      return;
    }
    if (!hasAccess) {
      onUpgrade();
      return;
    }
    if (!SYMBOL_RE.test(symbol)) {
      setError('Enter a valid ticker symbol.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setDataStatus(null);
    setQuoteDataStatus(null);
    setDataAsOf(null);

    try {
      const res = await fetch('/api/fundamentals?symbol=' + encodeURIComponent(symbol), {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (res.status === 403) {
        onUpgrade();
        throw new Error('Premium subscription required');
      }
      if (res.status === 404) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'No data found for ' + symbol + ' right now — try again in a few minutes.');
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Lookup failed');
      }
      const d = await res.json();
      setResult(d.result);
      setDataStatus(d.dataStatus || null);
      setQuoteDataStatus(d.quoteDataStatus || null);
      setDataAsOf(d.dataAsOf || d.scanTime || null);
      setRecentTickers(saveRecentTicker(user.id, symbol));
    } catch (e2) {
      setError(friendlyError(e2));
    } finally {
      setLoading(false);
    }
  }

  function runLookup(e) {
    e.preventDefault();
    lookupSymbol(symbolInput.trim().toUpperCase());
  }

  function lookupRecent(symbol) {
    setSymbolInput(symbol);
    lookupSymbol(symbol);
  }

  function removeRecent(symbol) {
    if (!user) return;
    setRecentTickers(removeRecentTicker(user.id, symbol));
  }

  if (!hasAccess) {
    return (
      <div className="page-content fund-page">
        <section className="empty-rich fund-guest-empty" aria-labelledby="fund-guest-title">
          <div className="empty-rich-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div className="empty-rich-skeleton-card" key={i}>
                <div className="empty-rich-skeleton-bar-label" />
                <div className={'empty-rich-skeleton-bar-value' + (i % 2 === 0 ? ' accent' : '')} />
              </div>
            ))}
          </div>
          <div className="empty-rich-overlay">
            <div className="empty-rich-card empty-rich-guest-card fund-guest-card">
              <div className="empty-rich-icon">
                <img src="/icon-192.png" alt="" />
              </div>
              <span className="empty-rich-kicker">FUNDAMENTALS DESK</span>
              <h3 id="fund-guest-title">Know what you&apos;re trading.</h3>
              <p>Review the key fundamentals behind any ticker — valuation, leverage, growth, and the next catalyst.</p>
              <div className="empty-rich-pills">
                <span className="empty-rich-pill">KEY FUNDAMENTALS</span>
                <span className="empty-rich-pill">TICKER LOOKUPS</span>
                <span className="empty-rich-pill">CLEAR CONTEXT</span>
              </div>
              <button className="empty-rich-cta" onClick={user ? onUpgrade : onCreateAccount || onSignIn}>
                {user ? 'Upgrade to Premium' : 'Create account'}
                {!user && <span aria-hidden="true">→</span>}
              </button>
              {!user && (
                <div className="empty-rich-signin">
                  <span>Already have an account?</span>{' '}
                  <button type="button" onClick={onSignIn}>
                    Sign in
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="fund-guest-note">
          <span className="fund-guest-note-icon" aria-hidden="true">
            i
          </span>
          Fundamentals are for education and research only — not investment advice.
        </div>
      </div>
    );
  }

  const visibleMetrics = SELECTABLE_METRICS.filter((m) => selectedMetrics.has(m.key));

  return (
    <div className="page-content fund-page">
      <header className="fund-workspace-head">
        <h1>Fundamentals</h1>
        <p>Build a focused company read before you trade.</p>
      </header>
      <div className="fund-panel">
        <form className="fund-search-row" onSubmit={runLookup}>
          <div className="fund-search-field">
            <svg
              className="fund-search-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="fund-search-input"
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              placeholder="Enter a ticker — e.g. AAPL"
              maxLength={10}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <button className="scan-btn fund-analyze-btn" type="submit" disabled={loading || !symbolInput.trim()}>
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </form>

        {recentTickers.length > 0 && (
          <div className="fund-recent">
            <span className="fund-recent-label">Recent</span>
            {recentTickers.map((sym) => (
              <div key={sym} className="fund-recent-chip">
                <button type="button" className="fund-recent-open" disabled={loading} onClick={() => lookupRecent(sym)}>
                  {sym}
                </button>
                <button
                  type="button"
                  className="fund-recent-remove"
                  disabled={loading}
                  onClick={() => removeRecent(sym)}
                  aria-label={`Remove ${sym} from recent searches`}
                  title={`Remove ${sym}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="fund-picker">
          <div className="fund-picker-head">
            <span className="fund-picker-title">Select Attributes</span>
            <span className="fund-picker-count">
              {selectedMetrics.size} <span className="fund-picker-count-total">/ {ALL_METRIC_KEYS.length}</span>
            </span>
          </div>
          <button type="button" className="fund-picker-toggle-all" onClick={toggleAll}>
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
          <div className="fund-toggles">
            {SELECTABLE_METRICS.map((m) => {
              const on = selectedMetrics.has(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  className={'fund-toggle' + (on ? ' active' : '')}
                  aria-pressed={on}
                  onClick={() => toggleMetric(m.key)}
                >
                  <span className="fund-toggle-icon">
                    <MetricIcon path={m.icon} />
                  </span>
                  <span className="fund-toggle-label">{m.label}</span>
                  <span className="fund-toggle-dot" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {loading && (
        <div className="fund-result fund-skeleton">
          <div className="fund-result-head">
            <div className="fund-result-id">
              <span className="skel-bar skel-symbol" />
              <span className="skel-bar skel-name" />
            </div>
            <div className="fund-result-quote">
              <span className="skel-bar skel-price" />
              <span className="skel-bar skel-change" />
              <span className="skel-bar skel-cap" />
            </div>
          </div>
          <div className="fund-grid">
            {(visibleMetrics.length ? visibleMetrics : SELECTABLE_METRICS).map((m) => (
              <div key={m.key} className="fund-tile">
                <div className="fund-tile-top">
                  <span className="skel-bar skel-tile-label" />
                  <span className="skel-bar skel-tile-sub" />
                </div>
                <span className="skel-bar skel-tile-value" />
              </div>
            ))}
          </div>
          <div className="fund-loading-caption">
            Pulling verified data for <span className="mono">{symbolInput.trim().toUpperCase()}</span>…
          </div>
        </div>
      )}

      {result && !loading && (
        <div className="fund-result">
          <div className="fund-result-head">
            <div className="fund-result-id">
              <span className="fund-result-symbol">{result.symbol}</span>
              <span className="fund-result-name">{result.name}</span>
            </div>
            <div className="fund-result-quote">
              <span className="fund-result-price">{formatPrice(result.price)}</span>
              <span
                className={
                  'fund-result-change ' + (result.change == null ? '' : result.change >= 0 ? 'is-up' : 'is-down')
                }
              >
                {result.change == null
                  ? '—'
                  : (result.change >= 0 ? '▲ ' : '▼ ') + Math.abs(result.change).toFixed(2) + '%'}
              </span>
              <span className="fund-result-cap">{fmtCap(result.marketCap)} cap</span>
            </div>
          </div>

          {dataStatus && dataStatus !== 'complete' && (
            <div className={'data-status-banner ' + dataStatus} role="status">
              <strong>
                {dataStatus === 'unavailable' ? 'Market data unavailable.' : 'Some data could not be fully verified.'}
              </strong>{' '}
              {quoteDataStatus === 'stale'
                ? 'The quote is from an earlier successful fetch. Try again in a few minutes for a fresh check.'
                : 'Try again in a few minutes before relying on this lookup.'}
              {dataAsOf && <span className="data-status-as-of"> Data as of {new Date(dataAsOf).toLocaleString()}</span>}
            </div>
          )}

          {visibleMetrics.length === 0 ? (
            <div className="fund-empty-hint">No metrics selected — pick some above, or hit “Select all”.</div>
          ) : (
            <div className="fund-grid">
              {visibleMetrics.map((m) => {
                const unverified = result.unverified && result.unverified[m.key];
                const raw = result[m.key];
                const hint = !unverified && m.hint ? m.hint(raw) : null;
                const tone = !unverified && m.tone ? m.tone(raw) : null;
                return (
                  <div key={m.key} className="fund-tile">
                    <div className="fund-tile-top">
                      <span className="fund-tile-label">{m.label}</span>
                      <span className="fund-tile-sub">{m.sub}</span>
                    </div>
                    {unverified ? (
                      <>
                        <div className="fund-tile-value is-unverified">—</div>
                        <div className="fund-tile-hint tone-warn">Not verified — try again in a few minutes</div>
                      </>
                    ) : (
                      <>
                        <div className={'fund-tile-value' + (tone ? ' tone-' + tone : '')}>{m.fmt(raw)}</div>
                        {hint && <div className={'fund-tile-hint tone-' + hint.tone}>{hint.text}</div>}
                      </>
                    )}
                    {m.key === 'peRatio' && <ForwardMultiple result={result} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
