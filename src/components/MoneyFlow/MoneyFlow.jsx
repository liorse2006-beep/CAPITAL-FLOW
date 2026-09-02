import React, { useState, useCallback, useEffect } from 'react';
import SectorHeatmap from './SectorHeatmap';
import ScanLoader from '../shared/ScanLoader';
import ScheduleScan from '../shared/ScheduleScan';
import MobileResultSort from '../shared/MobileResultSort';
import { fmt, friendlyError, formatPrice, formatRatio, formatSignedPercent } from '../../utils/format';
import { categoryQuota } from '../../utils/quota';
import { SECTOR_ETFS } from '../../constants';
import { useAuth } from '../../context/AuthContext';
import useScanQuota from '../../hooks/useScanQuota';
import useSeo from '../../hooks/useSeo';

export default function MoneyFlow({
  setShowUpgradeModal,
  onSignIn,
  onCreateAccount,
  onTrialEnded,
  alertLevels,
  promptCreateAlert,
}) {
  useSeo({
    title: 'מעקב תזרים הון לפי סקטורים בזמן אמת | Capital Flow',
    description:
      'ראו לאן זורם הכסף בשוק המניות: מעקב אחר תזרים כניסות ויציאות לפי סקטור, בזמן אמת, כדי לזהות מגמות לפני כולם.',
    path: '/flow',
  });
  const { user, getToken } = useAuth();
  // Trial users receive the same scan/filter surface as Elite. The server
  // still enforces the real tier and quota independently.
  const isPremium = !!(user && (user.is_premium || user.elite_access));
  const { scanMeta, setScanMeta, refreshQuota } = useScanQuota();

  const [flowData, setFlowData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchTime, setFetchTime] = useState(null);
  const [flowDataStatus, setFlowDataStatus] = useState(null);
  const [error, setError] = useState(null);
  const [expandedETF, setExpandedETF] = useState(null);
  const [flowSort, setFlowSort] = useState('volRatio');
  const [flowSortDir, setFlowSortDir] = useState('desc');

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  const handleFlowSort = function (f) {
    setFlowSortDir(flowSort === f ? (flowSortDir === 'asc' ? 'desc' : 'asc') : 'desc');
    setFlowSort(f);
  };

  const fetchFlow = useCallback(
    function () {
      if (!user) {
        onSignIn();
        return;
      }
      if (!isPremium && categoryQuota(scanMeta, 'sectorMoving').exhausted) {
        onTrialEnded();
        return;
      }
      setLoading(true);
      setError(null);
      fetch('/api/sector-flow', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) {
          if (r.status === 401) {
            onSignIn();
            throw new Error('Sign in to run a scan');
          }
          if (r.status === 403)
            return r.json().then(function (d) {
              throw Object.assign(new Error(d.error || 'Limit reached'), { code: d.code });
            });
          if (!r.ok)
            return r.json().then(function (d) {
              throw new Error(d.error || 'Fetch failed');
            });
          return r.json();
        })
        .then(function (d) {
          setFlowData(d.results);
          setFetchTime(d.fetchTime);
          setFlowDataStatus(d.dataStatus || 'complete');
          setScanMeta({ tier: d.tier, isPremium: d.isPremium, premium: d.premium, free: d.free });
        })
        .catch(function (e) {
          if (e.code === 'SCAN_LIMIT') {
            if (isPremium) setShowUpgradeModal(true);
            else onTrialEnded();
            return;
          }
          setError(e.message);
        })
        .finally(function () {
          setLoading(false);
        });
    },
    [user, isPremium, scanMeta, getToken, onSignIn, setShowUpgradeModal, setScanMeta, onTrialEnded]
  );

  const inflows = flowData
    ? flowData
        .filter(function (d) {
          return d.flow === 'inflow';
        })
        .sort(function (a, b) {
          return b.volRatio - a.volRatio;
        })
    : [];
  const outflows = flowData
    ? flowData
        .filter(function (d) {
          return d.flow === 'outflow';
        })
        .sort(function (a, b) {
          return b.volRatio - a.volRatio;
        })
    : [];
  const neutrals = flowData
    ? flowData.filter(function (d) {
        return d.flow === 'neutral';
      })
    : [];
  const etfMap = {};
  SECTOR_ETFS.forEach(function (s) {
    etfMap[s.ticker] = s;
  });

  return (
    <div className="page-content">
      <div className="flow-header">
        <div>
          <h2 className="flow-title">Hot Sectors</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="scan-btn" onClick={fetchFlow} disabled={loading}>
            {loading
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement('div', { className: 'spinner' }),
                  ' Fetching...'
                )
              : 'Refresh Flow'}
          </button>
          <ScheduleScan
            scanType="sectorMoving"
            user={user}
            onUpgrade={() => setShowUpgradeModal(true)}
            onSignIn={onSignIn}
          />
        </div>
      </div>

      {!isPremium &&
        scanMeta &&
        scanMeta.tier === 'premium' &&
        (function () {
          var q = categoryQuota(scanMeta, 'sectorMoving');
          var pct = ((q.used || 0) / (q.limit || 5)) * 100;
          return React.createElement(
            'div',
            { className: 'ma-usage', style: { marginBottom: 16 } },
            React.createElement(
              'div',
              { className: 'ma-usage-bar-wrap' },
              React.createElement('div', { className: 'ma-usage-bar', style: { width: pct + '%' } })
            ),
            React.createElement('span', { className: 'ma-usage-label' }, q.label)
          );
        })()}

      {error &&
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
            React.createElement('button', { className: 'error-retry-btn', onClick: fetchFlow }, 'Retry'),
            React.createElement(
              'button',
              {
                className: 'error-dismiss-btn',
                onClick: function () {
                  setError(null);
                },
              },
              'Dismiss'
            )
          )
        )}

      {!flowData && !loading && (
        <div className="empty-rich">
          <div className="empty-rich-skeleton">
            {[0, 1, 2, 3, 4, 5].map(function (i) {
              return (
                <div className="empty-rich-skeleton-card" key={i}>
                  <div className="empty-rich-skeleton-bar-label" />
                  <div className={'empty-rich-skeleton-bar-value' + (i % 2 === 0 ? ' accent' : '')} />
                </div>
              );
            })}
          </div>
          <div className="empty-rich-overlay">
            <div className={'empty-rich-card' + (user ? ' empty-rich-flow-card' : ' empty-rich-guest-card')}>
              <div className="empty-rich-icon">
                <img src="/icon-192.png" alt="" />
              </div>
              {user ? (
                <>
                  <span className="empty-rich-kicker">SECTOR FLOW</span>
                  <h3>See where capital is moving.</h3>
                  <p>Refresh the flow to track real-time inflows and outflows across every major market sector.</p>
                  <button className="empty-rich-cta" onClick={fetchFlow}>
                    Refresh Flow <span aria-hidden="true">→</span>
                  </button>
                </>
              ) : (
                <>
                  <span className="empty-rich-kicker">LIVE SECTOR INTELLIGENCE</span>
                  <h3>See where capital is moving.</h3>
                  <p>Sign in to track real-time inflows and outflows across every major market sector.</p>
                  <div className="empty-rich-pills">
                    <span className="empty-rich-pill">ALL SECTORS</span>
                    <span className="empty-rich-pill">LIVE DATA</span>
                  </div>
                  <button className="empty-rich-cta" onClick={onCreateAccount || onSignIn}>
                    Create account <span aria-hidden="true">→</span>
                  </button>
                  <div className="empty-rich-signin">
                    <span>Already have an account?</span>{' '}
                    <button type="button" onClick={onSignIn}>
                      Sign in
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <ScanLoader
          label="SECTOR MONEY FLOW"
          statusMessages={[
            'Pulling live sector ETF data…',
            'Measuring volume against sector averages…',
            'Checking inflows and outflows…',
            'Ranking sectors by relative strength…',
          ]}
        />
      )}

      {flowData &&
        React.createElement(
          'div',
          { style: { marginBottom: 16 } },
          React.createElement(SectorHeatmap, {
            flowData: flowData,
            etfMap: etfMap,
            onSectorClick: function (cell) {
              setExpandedETF(expandedETF === cell.symbol ? null : cell.symbol);
            },
            dataStatus: flowDataStatus,
          })
        )}

      {flowData &&
        (function () {
          var flowOrder = { inflow: 0, outflow: 1, neutral: 2 };
          var sorted = [].concat(flowData).sort(function (a, b) {
            var av, bv;
            if (flowSort === 'flow') {
              av = flowOrder[a.flow];
              bv = flowOrder[b.flow];
            } else if (flowSort === 'sector') {
              av = (etfMap[a.symbol] && etfMap[a.symbol].name) || a.symbol;
              bv = (etfMap[b.symbol] && etfMap[b.symbol].name) || b.symbol;
            } else {
              av = a[flowSort];
              bv = b[flowSort];
            }
            if (typeof av === 'string') return flowSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
            const aNumber = typeof av === 'number' && Number.isFinite(av) ? av : null;
            const bNumber = typeof bv === 'number' && Number.isFinite(bv) ? bv : null;
            if (aNumber === null && bNumber === null) return 0;
            if (aNumber === null) return 1;
            if (bNumber === null) return -1;
            return flowSortDir === 'asc' ? aNumber - bNumber : bNumber - aNumber;
          });
          var FTH = function (props) {
            return (
              <th
                className={flowSort === props.field ? 'active' : ''}
                onClick={function () {
                  handleFlowSort(props.field);
                }}
              >
                {props.label}
                {flowSort === props.field && <span className="sort-icon">{flowSortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            );
          };
          return (
            <div className="table-card">
              <div className="table-bar">
                <div>
                  <h2>All Sectors</h2>
                  <span className="table-bar-sub">
                    {inflows.length} inflow · {outflows.length} outflow · {neutrals.length} neutral
                  </span>
                </div>
                <span className="table-bar-count">{flowData.length} sectors</span>
              </div>
              <MobileResultSort
                options={[
                  { value: 'symbol', label: 'Ticker' },
                  { value: 'sector', label: 'Sector' },
                  { value: 'price', label: 'Price' },
                  { value: 'change', label: 'Change' },
                  { value: 'volRatio', label: 'Vol ratio' },
                  { value: 'flow', label: 'Flow' },
                ]}
                value={flowSort}
                direction={flowSortDir}
                onSort={handleFlowSort}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <FTH label="Ticker" field="symbol" />
                      <FTH label="Sector" field="sector" />
                      <FTH label="Price" field="price" />
                      <FTH label="Change %" field="change" />
                      <FTH label="Vol Ratio" field="volRatio" />
                      <th>Volume</th>
                      <FTH label="Flow" field="flow" />
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(function (d, i) {
                      var etf = etfMap[d.symbol];
                      var open = expandedETF === d.symbol;
                      return React.createElement(
                        React.Fragment,
                        { key: d.symbol },
                        React.createElement(
                          'tr',
                          {
                            className: 'flow-row ' + (open ? 'expanded' : ''),
                            onClick: function () {
                              setExpandedETF(open ? null : d.symbol);
                            },
                          },
                          React.createElement('td', { className: 'col-rank' }, i + 1),
                          React.createElement('td', { className: 'col-ticker' }, d.symbol),
                          React.createElement(
                            'td',
                            { className: 'col-name', style: { fontFamily: 'var(--font)' } },
                            (etf && etf.name) || d.symbol
                          ),
                          React.createElement('td', null, formatPrice(d.price)),
                          React.createElement(
                            'td',
                            { className: d.change == null ? '' : d.change >= 0 ? 'col-pos' : 'col-neg' },
                            formatSignedPercent(d.change, 2)
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'span',
                              {
                                className:
                                  'ratio-pill ' +
                                  (d.volRatio == null
                                    ? 'unavailable'
                                    : d.volRatio >= 2
                                      ? 'hot'
                                      : d.volRatio >= 1.2
                                        ? 'warm'
                                        : 'ok'),
                              },
                              formatRatio(d.volRatio)
                            )
                          ),
                          React.createElement(
                            'td',
                            { style: { color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 12 } },
                            fmt(d.volume)
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement('span', { className: 'flow-badge ' + d.flow }, d.flow.toUpperCase())
                          ),
                          React.createElement(
                            'td',
                            {
                              style: { display: 'flex', gap: 5, alignItems: 'center' },
                              onClick: (e) => e.stopPropagation(),
                            },
                            React.createElement(
                              'a',
                              {
                                className: 'chart-open-btn',
                                href: 'https://www.tradingview.com/chart/?symbol=' + d.symbol,
                                target: '_blank',
                                rel: 'noopener noreferrer',
                                title: 'Open in TradingView',
                                'aria-label': 'Open in TradingView',
                              },
                              React.createElement(
                                'svg',
                                {
                                  viewBox: '0 0 24 24',
                                  width: 14,
                                  height: 14,
                                  fill: 'none',
                                  stroke: 'currentColor',
                                  strokeWidth: 2,
                                  strokeLinecap: 'round',
                                  strokeLinejoin: 'round',
                                },
                                React.createElement('path', { d: 'M3 3v18h18' }),
                                React.createElement('path', { d: 'M18.7 8l-5.1 5.1-4-4L3 15.6' })
                              )
                            ),
                            React.createElement(
                              'button',
                              {
                                className: 'alert-create-btn' + (alertLevels && alertLevels[d.symbol] ? ' active' : ''),
                                onClick: () => promptCreateAlert(d.symbol),
                                title:
                                  alertLevels && alertLevels[d.symbol]
                                    ? 'Alert set at ' + alertLevels[d.symbol] + 'x — click to edit'
                                    : 'Create a volume alert',
                              },
                              React.createElement(
                                'svg',
                                {
                                  viewBox: '0 0 24 24',
                                  width: 14,
                                  height: 14,
                                  fill: 'none',
                                  stroke: 'currentColor',
                                  strokeWidth: 2,
                                  strokeLinecap: 'round',
                                  strokeLinejoin: 'round',
                                },
                                React.createElement('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
                                React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })
                              )
                            )
                          )
                        ),
                        open &&
                          etf &&
                          etf.holdings &&
                          React.createElement(
                            'tr',
                            { className: 'holdings-row' },
                            React.createElement(
                              'td',
                              { colSpan: '9' },
                              React.createElement(
                                'div',
                                { className: 'holdings-inline' },
                                React.createElement('span', { className: 'holdings-title' }, 'Top Holdings'),
                                React.createElement(
                                  'div',
                                  { className: 'holdings-chips' },
                                  etf.holdings.map(function (h) {
                                    return React.createElement(
                                      'div',
                                      { key: h.sym, className: 'holding-chip' },
                                      React.createElement('span', { className: 'holding-sym' }, h.sym),
                                      React.createElement('span', { className: 'holding-name' }, h.name),
                                      React.createElement('span', { className: 'holding-weight' }, h.weight)
                                    );
                                  })
                                )
                              )
                            )
                          )
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mobile-cards mobile-result-list money-flow-results">
                {sorted.map(function (d, i) {
                  var etf = etfMap[d.symbol];
                  var open = expandedETF === d.symbol;
                  return (
                    <div key={d.symbol} className="mobile-card mobile-result-card flow-result-card">
                      <div className="mobile-result-card-header">
                        <div className="mobile-result-card-identity">
                          <span className="mobile-result-card-rank">#{i + 1}</span>
                          <span className="mobile-card-ticker">{d.symbol}</span>
                          <span className="mobile-card-name">{(etf && etf.name) || d.symbol}</span>
                        </div>
                        <div className="mobile-result-card-actions">
                          <a
                            className="chart-open-btn"
                            href={'https://www.tradingview.com/chart/?symbol=' + d.symbol}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in TradingView"
                            aria-label={'Open ' + d.symbol + ' in TradingView'}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3 3v18h18" />
                              <path d="M18.7 8l-5.1 5.1-4-4L3 15.6" />
                            </svg>
                          </a>
                          <button
                            className={'alert-create-btn' + (alertLevels && alertLevels[d.symbol] ? ' active' : '')}
                            onClick={() => promptCreateAlert(d.symbol)}
                            title={
                              alertLevels && alertLevels[d.symbol]
                                ? 'Alert set at ' + alertLevels[d.symbol] + 'x — click to edit'
                                : 'Create a volume alert'
                            }
                            aria-label={'Create a volume alert for ' + d.symbol}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="mobile-result-card-quote">
                        <div className="mobile-result-card-quote-item">
                          <span className="mobile-result-card-label">PRICE</span>
                          <span className="mobile-card-price">{formatPrice(d.price)}</span>
                        </div>
                        <div className="mobile-result-card-quote-item mobile-result-card-quote-item-end">
                          <span className="mobile-result-card-label">CHANGE</span>
                          <span
                            className={'mobile-card-change ' + (d.change == null ? '' : d.change >= 0 ? 'pos' : 'neg')}
                          >
                            {formatSignedPercent(d.change, 2)}
                          </span>
                        </div>
                      </div>
                      <div className="mobile-result-card-grid">
                        <div className="mobile-result-card-stat">
                          <span className="mobile-result-card-label">VOL RATIO</span>
                          <span
                            className={
                              'ratio-pill ' +
                              (d.volRatio == null
                                ? 'unavailable'
                                : d.volRatio >= 2
                                  ? 'hot'
                                  : d.volRatio >= 1.2
                                    ? 'warm'
                                    : 'ok')
                            }
                          >
                            {formatRatio(d.volRatio)}
                          </span>
                        </div>
                        <div className="mobile-result-card-stat">
                          <span className="mobile-result-card-label">VOLUME</span>
                          <span className="mobile-result-card-value">{fmt(d.volume)}</span>
                        </div>
                        <div className="mobile-result-card-stat">
                          <span className="mobile-result-card-label">FLOW</span>
                          <span className={'flow-badge ' + d.flow}>{d.flow.toUpperCase()}</span>
                        </div>
                        <div className="mobile-result-card-stat mobile-result-card-stat-wide">
                          <span className="mobile-result-card-label">SECTOR</span>
                          <span className="mobile-result-card-sector-name">{(etf && etf.name) || d.symbol}</span>
                        </div>
                      </div>
                      {etf && etf.holdings && etf.holdings.length > 0 && (
                        <>
                          <button
                            className="flow-mobile-holdings-toggle"
                            onClick={() => setExpandedETF(open ? null : d.symbol)}
                            aria-expanded={open}
                          >
                            {open ? 'Hide top holdings' : 'View top holdings'}
                            <span aria-hidden="true">{open ? '−' : '+'}</span>
                          </button>
                          {open && (
                            <div className="flow-mobile-holdings" aria-label="Top holdings">
                              {etf.holdings.map(function (h) {
                                return (
                                  <div key={h.sym} className="flow-mobile-holding">
                                    <span className="holding-sym">{h.sym}</span>
                                    <span className="holding-name">{h.name}</span>
                                    <span className="holding-weight">{h.weight}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {fetchTime && <div className="table-footer">Last updated: {new Date(fetchTime).toLocaleString()}</div>}
            </div>
          );
        })()}
    </div>
  );
}
