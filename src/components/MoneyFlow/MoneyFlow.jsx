import React, { useState, useCallback, useEffect } from 'react';
import SectorHeatmap from './SectorHeatmap';
import ScanLoader from '../shared/ScanLoader';
import ScheduleScan from '../shared/ScheduleScan';
import { fmt, friendlyError } from '../../utils/format';
import { categoryQuota } from '../../utils/quota';
import { SECTOR_ETFS } from '../../constants';
import { useAuth } from '../../context/AuthContext';
import useScanQuota from '../../hooks/useScanQuota';

export default function MoneyFlow({ theme, setShowUpgradeModal, onSignIn }) {
  const { user, getToken } = useAuth();
  const isPremium = !!(user && user.is_premium);
  const { scanMeta, setScanMeta, refreshQuota } = useScanQuota();

  const [flowData, setFlowData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchTime, setFetchTime] = useState(null);
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
        setShowUpgradeModal(true);
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
          setScanMeta({ tier: d.tier, isPremium: d.isPremium, premium: d.premium, free: d.free });
        })
        .catch(function (e) {
          if (e.code === 'SCAN_LIMIT') {
            setShowUpgradeModal(true);
            return;
          }
          setError(e.message);
        })
        .finally(function () {
          setLoading(false);
        });
    },
    [user, isPremium, scanMeta, getToken, onSignIn, setShowUpgradeModal, setScanMeta]
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
          <h2 className="flow-title">Sector Money Flow</h2>
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
          {user && (
            <ScheduleScan
              scanType="sectorMoving"
              user={user}
              onUpgrade={() => setShowUpgradeModal(true)}
            />
          )}
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
            <div className="empty-rich-card">
              <div className="empty-rich-icon">
                <img src="/icon-192.png" alt="" />
              </div>
              <h3>Money Flow Analysis</h3>
              <p>TRACK WHERE CAPITAL IS ROTATING ACROSS EVERY SECTOR</p>
              <div className="empty-rich-pills">
                <span className="empty-rich-pill">11 SECTORS</span>
                <span className="empty-rich-pill">500+ STOCKS</span>
                <span className="empty-rich-pill">REAL-TIME DATA</span>
              </div>
              <button className="empty-rich-cta" onClick={fetchFlow}>
                Refresh Flow
              </button>
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
            return flowSortDir === 'asc' ? av - bv : bv - av;
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
                          React.createElement('td', null, '$' + d.price.toFixed(2)),
                          React.createElement(
                            'td',
                            { className: d.change >= 0 ? 'col-pos' : 'col-neg' },
                            (d.change >= 0 ? '+' : '') + d.change + '%'
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'span',
                              {
                                className:
                                  'ratio-pill ' + (d.volRatio >= 2 ? 'hot' : d.volRatio >= 1.2 ? 'warm' : 'ok'),
                              },
                              d.volRatio + 'x'
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
                              { colSpan: '8' },
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
              {fetchTime && <div className="table-footer">Last updated: {new Date(fetchTime).toLocaleString()}</div>}
            </div>
          );
        })()}
    </div>
  );
}
