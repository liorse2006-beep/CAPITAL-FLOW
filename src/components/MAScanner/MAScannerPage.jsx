import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import useScanQuota from '../../hooks/useScanQuota';
import ScanLoader from '../shared/ScanLoader';
import { categoryQuota } from '../../utils/quota';
import { friendlyError } from '../../utils/format';

const MA_OPTIONS = [9, 20, 50, 150];
const DISTANCE_OPTIONS = [1, 2];
const ALL_SECTORS = [
  'Technology',
  'Financials',
  'Health Care',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Industrials',
  'Materials',
  'Real Estate',
  'Utilities',
  'Communication Services',
  'Semiconductors',
];
const MAX_FREE_SECTORS = 2;

const MARKET_OPTIONS = [
  { key: 'all', label: 'All Stocks', meta: '~516', color: '#06B6D4' },
  { key: 'sp500', label: 'S&P 500', meta: '500', color: '#22C55E' },
  { key: 'nasdaq100', label: 'NASDAQ 100', meta: '100', color: '#3B82F6' },
  { key: 'sectors', label: 'By Sector', meta: '5/sec', color: '#F59E0B' },
];

function fmtCap(v) {
  if (!v) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
  return '—';
}

export default function MAScannerPage({ onOpenChart, onSignIn }) {
  const { getToken, user } = useAuth();
  const isPremium = !!(user && user.is_premium);

  const [ma, setMa] = useState(20);
  const [distance, setDistance] = useState(2);
  const [interval, setInterval] = useState('1d');
  const [market, setMarket] = useState('all');
  const [selectedSectors, setSelectedSectors] = useState([]);

  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [scanTime, setScanTime] = useState(null);

  const [sortField, setSort] = useState('maDistance');
  const [sortDir, setSortDir] = useState('asc');
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState('all');

  const { scanMeta, setScanMeta, refreshQuota } = useScanQuota();

  const pollRef = useRef(null);
  const authH = () => ({ Authorization: 'Bearer ' + getToken() });

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  function toggleSector(s) {
    setSelectedSectors((prev) => {
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      if (!isPremium && prev.length >= MAX_FREE_SECTORS) return prev;
      return [...prev, s];
    });
  }

  function startScan() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ processed: 0, total: 0, found: 0, phase: 1 });

    const params = new URLSearchParams({ ma, distance, interval, market });
    if (market === 'sectors' && selectedSectors.length > 0) {
      params.set('sectors', selectedSectors.join(','));
    }

    fetch(`/api/scan-ma?${params}`, { headers: authH() })
      .then((r) => {
        if (r.status === 403)
          return r.json().then((d) => {
            throw Object.assign(new Error(d.error || 'Limit reached'), { code: d.code });
          });
        if (!r.ok)
          return r.json().then((d) => {
            throw new Error(d.error || 'Scan failed');
          });
        return r.json();
      })
      .then((d) => {
        setResults(d.results);
        setScanTime(d.scanTime);
        setScanMeta({ tier: d.tier, isPremium: d.isPremium, premium: d.premium, free: d.free });
        setLoading(false);
        clearInterval(pollRef.current);
      })
      .catch((e) => {
        if (e.code === 'SCAN_LIMIT') refreshQuota();
        setError(e.message);
        setLoading(false);
        clearInterval(pollRef.current);
      });

    pollRef.current = setInterval(() => {
      fetch('/api/ma-progress', { headers: authH() })
        .then((r) => r.json())
        .then((d) => {
          if (d.running) setProgress(d);
        })
        .catch(() => {});
    }, 1500);
  }

  function handleSort(f) {
    setSortDir(sortField === f ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
    setSort(f);
  }

  const filtered = (results || []).filter((r) => {
    if (dirFilter !== 'all' && r.direction !== dirFilter) return false;
    if (!search) return true;
    return r.symbol.includes(search.toUpperCase()) || (r.name || '').toLowerCase().includes(search.toLowerCase());
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortField] ?? 0,
      bv = b[sortField] ?? 0;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const TH = ({ label, field }) =>
    React.createElement(
      'th',
      {
        className: sortField === field ? 'active' : '',
        onClick: () => handleSort(field),
      },
      label,
      sortField === field && React.createElement('span', { className: 'sort-icon' }, sortDir === 'asc' ? '▲' : '▼')
    );

  const scanLimitReached = !isPremium && categoryQuota(scanMeta, 'maScanner').exhausted;
  const intervalLabel = interval === '1d' ? 'Daily' : 'Weekly';
  const isLocked = !user;

  const selectedMarket = MARKET_OPTIONS.find((m) => m.key === market);

  return React.createElement(
    'div',
    { className: 'page-content' },

    // ── Header ──────────────────────────────────────────────────────────────
    React.createElement(
      'div',
      { className: 'flow-header' },
      React.createElement(
        'div',
        null,
        React.createElement('h2', { className: 'flow-title' }, 'Moving Average Scanner')
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        scanTime &&
          React.createElement(
            'span',
            { className: 'table-footer', style: { margin: 0 } },
            'Last scan: ' + new Date(scanTime).toLocaleTimeString()
          ),
        !isLocked &&
          React.createElement(
            'button',
            {
              className: 'scan-btn',
              onClick: startScan,
              disabled: loading || scanLimitReached,
            },
            loading
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement('div', { className: 'spinner' }),
                  ' Scanning...'
                )
              : results
                ? 'Re-scan'
                : 'Run MA Scan'
          )
      )
    ),

    // ── Sign-in banner ───────────────────────────────────────────────────────
    isLocked &&
      React.createElement(
        'div',
        { className: 'ma-signin-banner' },
        React.createElement(
          'div',
          null,
          React.createElement('div', { className: 'ma-signin-title' }, '🔒 Sign in to unlock MA Scanner'),
          React.createElement(
            'div',
            { className: 'ma-signin-sub' },
            'Free account includes 3 scans. Upgrade to Premium for unlimited.'
          )
        ),
        React.createElement(
          'button',
          { className: 'scan-btn', style: { flexShrink: 0 }, onClick: onSignIn },
          'Sign In / Register'
        )
      ),

    // ── Controls panel ───────────────────────────────────────────────────────
    React.createElement(
      'div',
      {
        className: 'ma-controls',
        style: isLocked ? { opacity: 0.4, pointerEvents: 'none', userSelect: 'none' } : undefined,
      },

      // Moving Average
      React.createElement(
        'div',
        { className: 'ma-ctrl-group' },
        React.createElement('span', { className: 'ma-ctrl-label' }, 'Moving Average'),
        React.createElement(
          'div',
          { className: 'ma-ctrl-btns' },
          MA_OPTIONS.map((v) =>
            React.createElement(
              'button',
              {
                key: v,
                className: 'ma-ctrl-btn' + (ma === v ? ' active' : ''),
                onClick: () => setMa(v),
                disabled: loading,
              },
              `SMA${v}`
            )
          )
        )
      ),

      // Distance
      React.createElement(
        'div',
        { className: 'ma-ctrl-group' },
        React.createElement('span', { className: 'ma-ctrl-label' }, 'Distance'),
        React.createElement(
          'div',
          { className: 'ma-ctrl-btns' },
          DISTANCE_OPTIONS.map((v) =>
            React.createElement(
              'button',
              {
                key: v,
                className: 'ma-ctrl-btn' + (distance === v ? ' active' : ''),
                onClick: () => setDistance(v),
                disabled: loading,
              },
              `±${v}%`
            )
          )
        )
      ),

      // Timeframe
      React.createElement(
        'div',
        { className: 'ma-ctrl-group' },
        React.createElement('span', { className: 'ma-ctrl-label' }, 'Timeframe'),
        React.createElement(
          'div',
          { className: 'ma-ctrl-btns' },
          React.createElement(
            'button',
            {
              className: 'ma-ctrl-btn' + (interval === '1d' ? ' active' : ''),
              onClick: () => setInterval('1d'),
              disabled: loading,
            },
            'Daily'
          ),
          React.createElement(
            'button',
            {
              className: 'ma-ctrl-btn' + (interval === '1wk' ? ' active' : ''),
              onClick: () => setInterval('1wk'),
              disabled: loading,
            },
            'Weekly'
          )
        )
      ),

      // Direction
      React.createElement(
        'div',
        { className: 'ma-ctrl-group' },
        React.createElement('span', { className: 'ma-ctrl-label' }, 'Direction'),
        React.createElement(
          'div',
          { className: 'ma-ctrl-btns' },
          ['all', 'above', 'below'].map((d) =>
            React.createElement(
              'button',
              {
                key: d,
                className: 'ma-ctrl-btn' + (dirFilter === d ? ' active' : ''),
                onClick: () => setDirFilter(d),
                disabled: loading,
              },
              d === 'all' ? 'All' : d === 'above' ? '▲ Above' : '▼ Below'
            )
          )
        )
      ),

      // Market
      React.createElement(
        'div',
        { className: 'ma-ctrl-group ma-ctrl-group-wide' },
        React.createElement('span', { className: 'ma-ctrl-label' }, 'Market'),
        React.createElement(
          'div',
          { className: 'ma-ctrl-btns' },
          MARKET_OPTIONS.map((opt) =>
            React.createElement(
              'button',
              {
                key: opt.key,
                className: 'ma-ctrl-btn ma-market-btn' + (market === opt.key ? ' active' : ''),
                style: market === opt.key ? { '--market-color': opt.color } : undefined,
                onClick: () => {
                  setMarket(opt.key);
                  if (opt.key !== 'sectors') setSelectedSectors([]);
                },
                disabled: loading,
              },
              React.createElement('span', null, opt.label)
            )
          )
        )
      ),

      // Usage counter
      !isPremium &&
        scanMeta &&
        React.createElement(
          'div',
          { className: 'ma-usage' },
          React.createElement(
            'div',
            { className: 'ma-usage-bar-wrap' },
            React.createElement('div', {
              className: 'ma-usage-bar',
              style: {
                width:
                  (scanMeta.tier === 'premium'
                    ? ((scanMeta.premium ? scanMeta.premium.used : 0) / 5) * 100
                    : categoryQuota(scanMeta, 'maScanner').exhausted
                      ? 100
                      : 0) + '%',
              },
            })
          ),
          React.createElement('span', { className: 'ma-usage-label' }, categoryQuota(scanMeta, 'maScanner').label)
        )
    ),

    // ── Sector grid (only when "By Sector" selected) ─────────────────────────
    !isLocked &&
      market === 'sectors' &&
      React.createElement(
        'div',
        { className: 'ma-sector-grid-wrap' },
        React.createElement(
          'div',
          { className: 'sector-grid-header' },
          React.createElement('span', null, 'Select Sectors'),
          selectedSectors.length > 0 &&
            React.createElement(
              'button',
              {
                className: 'sector-clear',
                onClick: () => setSelectedSectors([]),
              },
              'Clear all'
            )
        ),
        React.createElement(
          'div',
          { className: 'sector-grid' },
          ALL_SECTORS.map((s) => {
            const active = selectedSectors.includes(s);
            const locked = !isPremium && !active && selectedSectors.length >= MAX_FREE_SECTORS;
            return React.createElement(
              'button',
              {
                key: s,
                className: 'sector-card' + (active ? ' active' : '') + (locked ? ' locked' : ''),
                onClick: () => !locked && toggleSector(s),
                style: locked ? { opacity: 0.4 } : undefined,
              },
              React.createElement('div', { className: 'sector-card-glow' }),
              React.createElement('div', { className: 'sector-card-name' }, s),
              React.createElement('div', { className: 'sector-card-count' }, '5 tickers')
            );
          })
        ),
        selectedSectors.length === 0 &&
          React.createElement(
            'div',
            { className: 'sector-hint' },
            'No sectors selected — will scan top 5 from all sectors'
          ),
        !isPremium &&
          React.createElement(
            'div',
            { className: 'sector-hint' },
            'Free tier: up to ' + MAX_FREE_SECTORS + ' sectors. Upgrade for unlimited.'
          )
      ),

    // ── Scan limit banner ────────────────────────────────────────────────────
    scanLimitReached &&
      React.createElement(
        'div',
        { className: 'ma-limit-banner' },
        React.createElement('div', { className: 'ma-limit-icon' }, '🔒'),
        React.createElement(
          'div',
          null,
          React.createElement('div', { className: 'ma-limit-title' }, 'Scan limit reached'),
          React.createElement(
            'div',
            { className: 'ma-limit-sub' },
            scanMeta && scanMeta.tier === 'premium'
              ? "You've used all 5 scans for today — resets in 24h. Upgrade to Elite for unlimited scans and real-time alerts."
              : "You've used your free trial for this scan type. Upgrade to Premium for unlimited-feeling scanning, or Elite for scans plus real-time alerts."
          )
        )
      ),

    // ── Scan loader ──────────────────────────────────────────────────────────
    loading &&
      progress &&
      React.createElement(ScanLoader, {
        label: progress.phase === 1 ? 'FILTERING TICKERS' : 'COMPUTING MOVING AVERAGES',
        matches: progress.found || 0,
        statusMessages: [
          'Comparing price to the moving average…',
          'Checking every sector for setups…',
          'Flagging tickers within your distance threshold…',
          'Cross-referencing daily and weekly candles…',
        ],
      }),

    // ── Error ────────────────────────────────────────────────────────────────
    error &&
      React.createElement(
        'div',
        { className: 'error-bar error-bar-action' },
        React.createElement(
          'div',
          { className: 'error-bar-content' },
          React.createElement('span', null, friendlyError(error))
        ),
        React.createElement(
          'div',
          { className: 'error-bar-actions' },
          React.createElement(
            'button',
            { className: 'error-retry-btn', onClick: startScan, disabled: scanLimitReached },
            'Retry'
          ),
          React.createElement('button', { className: 'error-dismiss-btn', onClick: () => setError(null) }, 'Dismiss')
        )
      ),

    // ── Empty state ──────────────────────────────────────────────────────────
    !loading &&
      !results &&
      !error &&
      !scanLimitReached &&
      React.createElement(
        'div',
        { className: 'empty' },
        React.createElement(
          'div',
          { className: 'empty-icon' },
          React.createElement(
            'svg',
            { viewBox: '0 0 24 24', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' },
            React.createElement('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })
          )
        ),
        React.createElement('h2', null, 'Moving Average Scanner'),
        React.createElement(
          'p',
          null,
          'Find stocks where price is touching a key moving average. Select your market universe, SMA period, tolerance, and timeframe — then run the scan.'
        ),
        !isPremium &&
          scanMeta &&
          React.createElement(
            'p',
            { style: { color: 'var(--text-2)', fontSize: 13, marginTop: 8 } },
            categoryQuota(scanMeta, 'maScanner').label
          )
      ),

    // ── Results ──────────────────────────────────────────────────────────────
    results &&
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { className: 'table-card' },
          React.createElement(
            'div',
            { className: 'table-bar' },
            React.createElement(
              'div',
              null,
              React.createElement(
                'h2',
                null,
                `SMA${ma} Proximity — ±${distance}% (${intervalLabel})` +
                  (selectedMarket ? ` · ${selectedMarket.label}` : '')
              ),
              React.createElement(
                'span',
                { className: 'table-bar-sub' },
                sorted.length +
                  ' results' +
                  (filtered.length < results.length ? ` · ${results.length - filtered.length} filtered` : '')
              )
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              // Search
              React.createElement('input', {
                className: 'ma-search',
                type: 'text',
                placeholder: 'Search ticker / name…',
                value: search,
                onChange: (e) => setSearch(e.target.value),
              })
            )
          ),

          // Mobile cards — the desktop <table> is hidden below 768px (global
          // rule), so results need a dedicated mobile layout or they'd just
          // vanish with no results visible and no error.
          React.createElement(
            'div',
            { className: 'mobile-cards' },
            sorted.length === 0
              ? React.createElement(
                  'div',
                  { className: 'empty', style: { padding: '32px 20px' } },
                  React.createElement('p', null, 'No results match your filters')
                )
              : sorted.map((r, i) => {
                  const isAbove = r.direction === 'above';
                  const distAbs = Math.abs(r.maDistance);
                  const distColor = distAbs < 0.5 ? 'var(--accent)' : isAbove ? 'var(--green)' : 'var(--red)';
                  return React.createElement(
                    'div',
                    { key: r.symbol, className: 'mobile-card' },
                    React.createElement(
                      'div',
                      { className: 'mobile-card-top' },
                      React.createElement('span', { className: 'mobile-card-ticker' }, r.symbol),
                      r.name && React.createElement('span', { className: 'mobile-card-name' }, r.name),
                      React.createElement('span', { className: 'mobile-card-rank' }, '#' + (i + 1))
                    ),
                    React.createElement(
                      'div',
                      { className: 'mobile-card-mid' },
                      React.createElement(
                        'span',
                        { className: 'mobile-card-price' },
                        r.price ? '$' + r.price.toFixed(2) : '—'
                      ),
                      React.createElement(
                        'span',
                        { className: 'mobile-card-change', style: { color: distColor } },
                        (r.maDistance >= 0 ? '+' : '') + r.maDistance.toFixed(2) + '%'
                      )
                    ),
                    React.createElement(
                      'div',
                      { className: 'mobile-card-bottom' },
                      React.createElement(
                        'span',
                        { className: 'mobile-card-vol' },
                        `SMA${ma}: $${r.maValue.toFixed(2)}`
                      )
                    )
                  );
                })
          ),

          React.createElement(
            'div',
            { className: 'table-wrap' },
            React.createElement(
              'table',
              null,
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', { style: { width: 36 } }, '#'),
                  React.createElement(TH, { label: 'Ticker', field: 'symbol' }),
                  React.createElement(TH, { label: 'Name', field: 'name' }),
                  React.createElement(TH, { label: 'Price', field: 'price' }),
                  React.createElement(TH, { label: `SMA${ma}`, field: 'maValue' }),
                  React.createElement(TH, { label: 'Distance %', field: 'maDistance' })
                )
              ),
              React.createElement(
                'tbody',
                null,
                sorted.length === 0
                  ? React.createElement(
                      'tr',
                      null,
                      React.createElement(
                        'td',
                        {
                          colSpan: 6,
                          style: {
                            textAlign: 'center',
                            padding: '32px',
                            color: 'var(--text-2)',
                            fontFamily: 'var(--mono)',
                            fontSize: 12,
                          },
                        },
                        'No results match your filters'
                      )
                    )
                  : sorted.map((r, i) => {
                      const isAbove = r.direction === 'above';
                      const distAbs = Math.abs(r.maDistance);
                      const distColor = distAbs < 0.5 ? 'var(--accent)' : isAbove ? 'var(--green)' : 'var(--red)';
                      return React.createElement(
                        'tr',
                        { key: r.symbol, className: 'flow-row' },
                        React.createElement('td', { className: 'col-rank' }, i + 1),
                        React.createElement('td', { className: 'col-ticker' }, r.symbol),
                        React.createElement('td', { className: 'col-name' }, r.name || '—'),
                        React.createElement('td', null, r.price ? '$' + r.price.toFixed(2) : '—'),
                        React.createElement(
                          'td',
                          { style: { fontFamily: 'var(--mono)', fontSize: 12 } },
                          '$' + r.maValue.toFixed(2)
                        ),
                        React.createElement(
                          'td',
                          null,
                          React.createElement(
                            'span',
                            { className: 'ma-distance-cell', style: { color: distColor } },
                            (r.maDistance >= 0 ? '+' : '') + r.maDistance.toFixed(2) + '%'
                          )
                        )
                      );
                    })
              )
            )
          )
        )
      )
  );
}
