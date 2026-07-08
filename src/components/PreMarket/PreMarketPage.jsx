import React, { useState } from 'react'
import { fmt } from '../../utils/format'
import { useAuth } from '../../context/AuthContext'

export default function PreMarketPage({ isPremium, onOpenChart }) {
  const { getToken }  = useAuth();
  const [results, setResults]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError]       = useState(null);
  const [scanTime, setScanTime] = useState(null);
  const [sortField, setSort]    = useState('volumeRatio');
  const [sortDir, setSortDir]   = useState('desc');
  const [search, setSearch]     = useState('');
  const pollRef = React.useRef(null);

  function startScan() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ processed: 0, total: 0, found: 0 });

    const authHeader = { Authorization: 'Bearer ' + getToken() };

    fetch('/api/scan-premarket', { headers: authHeader })
      .then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.error || 'Scan failed'); }))
      .then(d => {
        setResults(d.results);
        setScanTime(d.scanTime);
        setLoading(false);
        clearInterval(pollRef.current);
      })
      .catch(e => { setError(e.message); setLoading(false); clearInterval(pollRef.current); });

    pollRef.current = setInterval(() => {
      fetch('/api/premarket-progress', { headers: authHeader })
        .then(r => r.json())
        .then(d => { if (d.progress) setProgress(d.progress); })
        .catch(() => {});
    }, 1000);
  }

  function handleSort(f) {
    setSortDir(sortField === f ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc');
    setSort(f);
  }

  const filtered = (results || []).filter(r =>
    !search || r.symbol.includes(search.toUpperCase()) || (r.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const TH = ({ label, field }) => React.createElement('th', {
    className: sortField === field ? 'active' : '',
    onClick: () => handleSort(field),
  }, label, sortField === field && React.createElement('span', { className: 'sort-icon' }, sortDir === 'asc' ? '▲' : '▼'));

  return React.createElement('div', { className: 'page-content' },

    // Header
    React.createElement('div', { className: 'flow-header' },
      React.createElement('div', null,
        React.createElement('h2', { className: 'flow-title' }, 'Pre-Market Scanner'),
        React.createElement('p', { className: 'flow-sub' }, '4:00 AM – 9:30 AM ET · Unusual pre-market volume spikes'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        scanTime && React.createElement('span', { className: 'table-footer', style: { margin: 0 } },
          'Last scan: ' + new Date(scanTime).toLocaleTimeString()
        ),
        React.createElement('button', { className: 'scan-btn', onClick: startScan, disabled: loading },
          loading
            ? React.createElement(React.Fragment, null, React.createElement('div', { className: 'spinner' }), ' Scanning...')
            : (results ? 'Re-scan' : 'Run Pre-Market Scan')
        )
      )
    ),

    // Progress bar
    loading && progress && React.createElement('div', { className: 'progress-wrap' },
      React.createElement('div', { className: 'progress-top' },
        React.createElement('span', null, 'SCANNING PRE-MARKET'),
        React.createElement('span', null,
          (progress.found || 0) + ' spikes found · ' +
          (progress.processed || 0) + (progress.total ? '/' + progress.total : '') + ' tickers'
        )
      ),
      React.createElement('div', { className: 'progress-track' },
        React.createElement('div', { className: 'progress-bar', style: {
          width: progress.total ? Math.round((progress.processed / progress.total) * 100) + '%' : '30%'
        }})
      )
    ),

    // Error
    error && React.createElement('div', { className: 'error-bar error-bar-action' },
      React.createElement('div', { className: 'error-bar-content' }, React.createElement('span', null, error)),
      React.createElement('div', { className: 'error-bar-actions' },
        React.createElement('button', { className: 'error-retry-btn', onClick: startScan }, 'Retry'),
        React.createElement('button', { className: 'error-dismiss-btn', onClick: () => setError(null) }, 'Dismiss')
      )
    ),

    // Empty state
    !loading && !results && !error && React.createElement('div', { className: 'empty' },
      React.createElement('div', { className: 'empty-icon' },
        React.createElement('svg', { viewBox: '0 0 24 24', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('circle', { cx: '12', cy: '12', r: '10' }),
          React.createElement('polyline', { points: '12 6 12 12 16 14' })
        )
      ),
      React.createElement('h2', null, 'Pre-Market Scanner'),
      React.createElement('p', null, 'Catch unusual volume spikes before the opening bell. Best run between 4:00–9:30 AM ET.'),
    ),

    // Results table
    results && React.createElement(React.Fragment, null,
      // Search bar + count
      React.createElement('div', { className: 'table-card' },
        React.createElement('div', { className: 'table-bar' },
          React.createElement('div', null,
            React.createElement('h2', null, 'Pre-Market Movers'),
            React.createElement('span', { className: 'table-bar-sub' },
              sorted.length + ' results · ' + (results.length - sorted.length > 0 ? (results.length - sorted.length) + ' filtered' : 'all shown')
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement('input', {
              className: 'search-input',
              placeholder: 'Search ticker…',
              value: search,
              onChange: e => setSearch(e.target.value),
            }),
            React.createElement('span', { className: 'table-bar-count' }, results.length + ' tickers'),
          )
        ),

        React.createElement('div', { className: 'table-wrap' },
          React.createElement('table', null,
            React.createElement('thead', null,
              React.createElement('tr', null,
                React.createElement('th', { style: { width: 36 } }, '#'),
                React.createElement(TH, { label: 'Ticker', field: 'symbol' }),
                React.createElement(TH, { label: 'Name', field: 'name' }),
                React.createElement(TH, { label: 'Price', field: 'price' }),
                React.createElement(TH, { label: 'Change %', field: 'change' }),
                React.createElement(TH, { label: 'Vol Ratio', field: 'volumeRatio' }),
                React.createElement('th', null, 'Pre-Mkt Vol'),
                React.createElement(TH, { label: 'Mkt Cap', field: 'marketCap' }),
                React.createElement('th', null, 'Chart'),
              )
            ),
            React.createElement('tbody', null,
              sorted.length === 0
                ? React.createElement('tr', null,
                    React.createElement('td', { colSpan: 9, style: { textAlign: 'center', padding: '32px', color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 12 } },
                      'No pre-market movers found'
                    )
                  )
                : sorted.map((r, i) =>
                    React.createElement('tr', { key: r.symbol, className: 'flow-row' },
                      React.createElement('td', { className: 'col-rank' }, i + 1),
                      React.createElement('td', { className: 'col-ticker' }, r.symbol),
                      React.createElement('td', { className: 'col-name' }, r.name || '—'),
                      React.createElement('td', null, r.price ? '$' + r.price.toFixed(2) : '—'),
                      React.createElement('td', { className: (r.change || 0) >= 0 ? 'col-pos' : 'col-neg' },
                        r.change != null ? ((r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%') : '—'
                      ),
                      React.createElement('td', null,
                        React.createElement('span', { className: 'ratio-pill ' + (r.volumeRatio >= 5 ? 'hot' : r.volumeRatio >= 2 ? 'warm' : 'ok') },
                          (r.volumeRatio || 0).toFixed(1) + 'x'
                        )
                      ),
                      React.createElement('td', { style: { color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 12 } }, fmt(r.volume)),
                      React.createElement('td', { style: { color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 12 } },
                        r.marketCap >= 1e12 ? '$' + (r.marketCap / 1e12).toFixed(1) + 'T'
                          : r.marketCap >= 1e9  ? '$' + (r.marketCap / 1e9).toFixed(1) + 'B'
                          : r.marketCap >= 1e6  ? '$' + (r.marketCap / 1e6).toFixed(0) + 'M'
                          : '—'
                      ),
                      React.createElement('td', null,
                        React.createElement('button', {
                          className: 'chart-open-btn',
                          onClick: () => onOpenChart(r.symbol, r.name || r.symbol),
                          title: 'Open chart',
                        }, '📈')
                      )
                    )
                  )
            )
          )
        )
      )
    )
  );
}
