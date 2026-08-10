import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/format';

const SYMBOL_RE = /^[A-Za-z0-9.-]{1,10}$/;

// Swing-trading fundamentals only — no PEG, no institutional ownership, no
// multi-year balance-sheet detail. Just the handful of numbers that matter
// for a position measured in days-to-weeks: liquidity/squeeze setup (Float,
// Short %), a quick valuation sanity check (P/E), balance-sheet risk
// (Debt/Equity), a growth signal (5Y revenue growth), and the next
// volatility catalyst (earnings date). The customer picks which of these to
// see — Market Cap/Price/Change stay in the header, always shown, since
// they're baseline context rather than a "filter" choice.
const SELECTABLE_METRICS = [
  { key: 'floatShares', label: 'Float', fmt: fmtShares },
  { key: 'shortPercent', label: 'Short % of Float', fmt: (v) => fmtPct(v * 100) },
  { key: 'peRatio', label: 'P/E Ratio', fmt: fmtRatio },
  { key: 'debtToEquity', label: 'Debt / Equity', fmt: fmtRatio },
  { key: 'revenueGrowth5Y', label: '5-Year Revenue Growth', fmt: fmtGrowth },
  { key: 'nextEarningsDate', label: 'Next Earnings', fmt: fmtEarnings },
];
const ALL_METRIC_KEYS = SELECTABLE_METRICS.map((m) => m.key);

function fmtCap(v) {
  if (!v) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}
function fmtShares(v) {
  if (!v) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B shares';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M shares';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K shares';
  return String(v) + ' shares';
}
function fmtPct(v) {
  return v ? v.toFixed(1) + '%' : '—';
}
function fmtRatio(v) {
  return v ? v.toFixed(2) : '—';
}
// null (not reported) and 0% growth must stay visually distinguishable —
// never collapse "unknown" into "zero".
function fmtGrowth(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtEarnings(v) {
  if (!v) return '—';
  return new Date(v + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function FundamentalsPage({ onUpgrade, onSignIn }) {
  const { getToken, user } = useAuth();
  const isPremium = !!(user && user.is_premium);

  const [symbolInput, setSymbolInput] = useState('');
  const [selectedMetrics, setSelectedMetrics] = useState(() => new Set(ALL_METRIC_KEYS));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function toggleMetric(key) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function selectAllMetrics() {
    setSelectedMetrics(new Set(ALL_METRIC_KEYS));
  }

  async function runLookup(e) {
    e.preventDefault();
    if (!user) {
      onSignIn();
      return;
    }
    if (!isPremium) {
      onUpgrade();
      return;
    }
    const symbol = symbolInput.trim().toUpperCase();
    if (!SYMBOL_RE.test(symbol)) {
      setError('Enter a valid ticker symbol.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

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
        // A genuine "we looked and there's nothing" — distinct from the
        // per-field "couldn't verify" case below, which still returns 200
        // with whatever the source did answer.
        throw new Error(d.error || ('No data found for ' + symbol + ' right now — try again in a few minutes.'));
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Lookup failed');
      }
      const d = await res.json();
      setResult(d.result);
    } catch (e2) {
      setError(friendlyError(e2));
    } finally {
      setLoading(false);
    }
  }

  if (!isPremium) {
    return (
      <div className="page-content">
        <div className="notif-settings-panel notif-settings-upsell">
          <div className="notif-settings-row">
            <div>
              <div className="notif-settings-title">Fundamentals</div>
              <div className="notif-settings-sub">
                Type in any ticker and get its float, short interest, P/E, debt/equity, 5-year revenue
                growth, and next earnings date — Premium/Elite feature, built for a swing decision, not a
                full equity-research report.
              </div>
            </div>
            <button className="notif-toggle-btn" onClick={user ? onUpgrade : onSignIn}>
              {user ? 'Upgrade to Premium' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="scan-filters-panel">
        <form className="fund-search-row" onSubmit={runLookup}>
          <input
            className="fund-search-input"
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="Enter a ticker — e.g. AAPL"
            maxLength={10}
            autoCapitalize="characters"
          />
          <button className="scan-btn" type="submit" disabled={loading || !symbolInput.trim()}>
            {loading ? 'Looking up…' : 'Analyze'}
          </button>
        </form>

        <div className="fund-metric-picker">
          <div className="fund-metric-picker-head">
            <span className="ma-ctrl-label">Show</span>
            <button type="button" className="sector-clear" onClick={selectAllMetrics}>
              ALL
            </button>
          </div>
          <div className="fund-metric-chips">
            {SELECTABLE_METRICS.map((m) => (
              <label key={m.key} className={'fund-metric-chip' + (selectedMetrics.has(m.key) ? ' active' : '')}>
                <input
                  type="checkbox"
                  checked={selectedMetrics.has(m.key)}
                  onChange={() => toggleMetric(m.key)}
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="error-bar">{error}</div>}

      {result && !loading && (
        <div className="table-card fund-result-card">
          <div className="fund-result-header">
            <div>
              <span className="fund-result-symbol">{result.symbol}</span>
              <span className="fund-result-name">{result.name}</span>
            </div>
            <div className="fund-result-price">
              <span>{'$' + result.price.toFixed(2)}</span>
              <span className={result.change >= 0 ? 'col-pos' : 'col-neg'}>
                {(result.change >= 0 ? '+' : '') + result.change.toFixed(2) + '%'}
              </span>
              <span className="fund-result-cap">{fmtCap(result.marketCap)}</span>
            </div>
          </div>

          {selectedMetrics.size === 0 ? (
            <div className="sector-hint">Nothing selected above — pick at least one metric, or click ALL.</div>
          ) : (
            <div className="fund-metric-grid">
              {SELECTABLE_METRICS.filter((m) => selectedMetrics.has(m.key)).map((m) => {
                const unverified = result.unverified && result.unverified[m.key];
                return (
                  <div key={m.key} className="fund-metric-tile">
                    <div className="fund-metric-label">{m.label}</div>
                    {unverified ? (
                      <div className="fund-metric-unverified">Not verified — try again in a few minutes</div>
                    ) : (
                      <div className="fund-metric-value">{m.fmt(result[m.key])}</div>
                    )}
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
