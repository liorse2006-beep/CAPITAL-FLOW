import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import ScanLoader from '../shared/ScanLoader';
import { friendlyError } from '../../utils/format';

const MARKET_OPTIONS = [
  { key: 'all', label: 'All Stocks', meta: '~516' },
  { key: 'sp500', label: 'S&P 500', meta: '500' },
  { key: 'nasdaq100', label: 'NASDAQ 100', meta: '100' },
];

// Swing-trading fundamentals only — no PEG, no institutional ownership, no
// multi-year balance-sheet detail. Just the handful of numbers that matter
// for a position measured in days-to-weeks: liquidity/squeeze setup (Float,
// Short %), a quick valuation sanity check (P/E), balance-sheet risk
// (Debt/Equity), a growth signal (5Y revenue growth), and the next
// volatility catalyst (earnings date).
const COLUMNS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'price', label: 'Price' },
  { key: 'change', label: 'Change %' },
  { key: 'marketCap', label: 'Market Cap' },
  { key: 'floatShares', label: 'Float' },
  { key: 'shortPercent', label: 'Short %' },
  { key: 'peRatio', label: 'P/E' },
  { key: 'debtToEquity', label: 'Debt/Equity' },
  { key: 'revenueGrowth5Y', label: '5Y Rev Growth' },
  { key: 'nextEarningsDate', label: 'Next Earnings' },
];

function fmtCap(v) {
  if (!v) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}
function fmtShares(v) {
  if (!v) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
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
  return new Date(v + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function FundamentalsPage({ onUpgrade, onSignIn }) {
  const { getToken, user } = useAuth();
  const isPremium = !!(user && user.is_premium);

  const [market, setMarket] = useState('all');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [scanTime, setScanTime] = useState(null);
  const [sortField, setSortField] = useState('marketCap');
  const [sortDir, setSortDir] = useState('desc');

  function handleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const sorted = (results || [])
    .slice()
    .sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const an = av == null ? -Infinity : av;
      const bn = bv == null ? -Infinity : bv;
      if (typeof an === 'string' || typeof bn === 'string') {
        return sortDir === 'asc' ? String(an).localeCompare(String(bn)) : String(bn).localeCompare(String(an));
      }
      return sortDir === 'asc' ? an - bn : bn - an;
    });

  async function runScan() {
    if (!user) {
      onSignIn();
      return;
    }
    if (!isPremium) {
      onUpgrade();
      return;
    }
    setLoading(true);
    setError(null);
    setProgress({ processed: 0, total: 1, found: 0 });

    const poll = setInterval(() => {
      fetch('/api/fundamentals-progress', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then((r) => r.json())
        .then((d) => {
          if (d.running) setProgress(d);
          if (!d.running) clearInterval(poll);
        })
        .catch(() => {});
    }, 500);

    try {
      const res = await fetch('/api/scan-fundamentals?market=' + market, {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (res.status === 403) {
        onUpgrade();
        throw new Error('Premium subscription required');
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Scan failed');
      }
      const d = await res.json();
      setResults(d.results);
      setScanTime(d.scanTime);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      clearInterval(poll);
      setLoading(false);
      setProgress(null);
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
                Float, short interest, P/E, debt/equity, 5-year revenue growth, and next earnings date —
                Premium/Elite feature, built for swing positions, not a full equity-research report.
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
    <div className="page-container">
      <div className="scan-filters-panel">
        <div className="scan-mode-options">
          {MARKET_OPTIONS.map((m) => (
            <button
              key={m.key}
              className={'scan-mode-card' + (market === m.key ? ' active' : '')}
              onClick={() => setMarket(m.key)}
            >
              <div className="scan-mode-label">{m.label}</div>
              <div className="scan-mode-desc">{m.meta} tickers</div>
            </button>
          ))}
        </div>
        <div className="scan-filters-actions">
          <button className="scan-btn" onClick={runScan} disabled={loading}>
            {loading ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      {loading && (
        <ScanLoader
          label="FUNDAMENTALS"
          matches={(progress && progress.found) || 0}
          statusMessages={[
            'Pulling float and short interest…',
            'Checking valuation and balance-sheet ratios…',
            'Looking up next earnings dates…',
            'Building the results table…',
          ]}
        />
      )}
      {error && <div className="error-bar">{error}</div>}

      {results && !loading && (
        <div className="table-card">
          <div className="table-bar">
            <div>
              <h2>Fundamentals{market !== 'all' && ' · ' + MARKET_OPTIONS.find((m) => m.key === market)?.label}</h2>
              <span className="table-bar-sub">
                {results.length + ' companies'}
                {scanTime && ' · Scanned ' + new Date(scanTime).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Mobile cards — the desktop <table> is hidden below 768px (global rule) */}
          <div className="mobile-cards">
            {sorted.length === 0 ? (
              <div className="empty" style={{ padding: '32px 20px' }}>
                <p>No matches for this universe.</p>
              </div>
            ) : (
              sorted.map((r) => (
                <div key={r.symbol} className="mobile-card">
                  <div className="mobile-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mobile-card-ticker">{r.symbol}</span>
                      <span className="mobile-card-name">{r.name}</span>
                    </div>
                  </div>
                  <div className="mobile-card-mid">
                    <span className="mobile-card-price">{'$' + r.price.toFixed(2)}</span>
                    <span className={'mobile-card-change ' + (r.change >= 0 ? 'col-pos' : 'col-neg')}>
                      {(r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%'}
                    </span>
                  </div>
                  <div className="mobile-card-bottom" style={{ flexWrap: 'wrap', gap: '6px 14px' }}>
                    <span className="mobile-card-vol">Float: {fmtShares(r.floatShares)}</span>
                    <span className="mobile-card-vol">Short: {fmtPct(r.shortPercent * 100)}</span>
                    <span className="mobile-card-vol">P/E: {fmtRatio(r.peRatio)}</span>
                    <span className="mobile-card-vol">D/E: {fmtRatio(r.debtToEquity)}</span>
                    <span className="mobile-card-vol">5Y Rev: {fmtGrowth(r.revenueGrowth5Y)}</span>
                    <span className="mobile-card-vol">Earnings: {fmtEarnings(r.nextEarningsDate)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} onClick={() => handleSort(c.key)} style={{ cursor: 'pointer' }}>
                      {c.label}
                      {sortField === c.key && <span className="sort-icon">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-3)' }}>
                      No matches for this universe.
                    </td>
                  </tr>
                )}
                {sorted.map((r) => (
                  <tr key={r.symbol}>
                    <td style={{ fontWeight: 700 }}>{r.symbol}</td>
                    <td>{'$' + r.price.toFixed(2)}</td>
                    <td className={r.change >= 0 ? 'col-pos' : 'col-neg'}>
                      {(r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%'}
                    </td>
                    <td>{fmtCap(r.marketCap)}</td>
                    <td>{fmtShares(r.floatShares)}</td>
                    <td>{fmtPct(r.shortPercent * 100)}</td>
                    <td>{fmtRatio(r.peRatio)}</td>
                    <td>{fmtRatio(r.debtToEquity)}</td>
                    <td className={r.revenueGrowth5Y != null && r.revenueGrowth5Y >= 0 ? 'col-pos' : r.revenueGrowth5Y != null ? 'col-neg' : ''}>
                      {fmtGrowth(r.revenueGrowth5Y)}
                    </td>
                    <td>{fmtEarnings(r.nextEarningsDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
