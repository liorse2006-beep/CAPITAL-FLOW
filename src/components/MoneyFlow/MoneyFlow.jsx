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
import { sectorName, flowLabel } from '../../utils/marketCopy';

export default function MoneyFlow({
  setShowUpgradeModal,
  onSignIn,
  onCreateAccount,
  onTrialEnded,
  alertLevels,
  promptCreateAlert,
  pushSupported,
  pushEnabled,
  pushBusy,
  pushError,
  onEnablePush,
}) {
  useSeo({
    title: 'פעילות שוק לפי סקטור | Capital Flow',
    description:
      'סקירת תנועות המחיר ונפח המסחר בסקטורים השונים. הנתונים עשויים להיות מעוכבים או חלקיים ויש לבדוק אותם באופן עצמאי.',
    path: '/flow',
  });
  const { user, getToken } = useAuth();
  // Trial users receive the same scan/filter surface as Elite. The server
  // still enforces the real tier and quota independently.
  const isPremium = !!(user && (user.is_premium || user.elite_access));
  const { scanMeta, setScanMeta, refreshQuota } = useScanQuota();

  const [flowData, setFlowData] = useState(null);
  const [loading, setLoading] = useState(false);
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
            throw new Error('התחברות to run a scan');
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
          <h2 className="flow-title">פעילות בסקטורים</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="scan-btn" onClick={fetchFlow} disabled={loading}>
            {loading
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement('div', { className: 'spinner' }),
                  ' טוענים…'
                )
              : 'עדכון הסקטורים'}
          </button>
          <ScheduleScan
            scanType="sectorMoving"
            user={user}
            onUpgrade={() => setShowUpgradeModal(true)}
            onSignIn={onSignIn}
            pushSupported={pushSupported}
            pushEnabled={pushEnabled}
            pushBusy={pushBusy}
            pushError={pushError}
            onEnablePush={onEnablePush}
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
            React.createElement('button', { className: 'error-retry-btn', onClick: fetchFlow }, 'ניסיון נוסף'),
            React.createElement(
              'button',
              {
                className: 'error-dismiss-btn',
                onClick: function () {
                  setError(null);
                },
              },
              'סגירה'
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
                  <span className="empty-rich-kicker">תמונת הסקטורים</span>
                  <h3>ראה מה קורה בסקטורים השונים.</h3>
                  <p>עדכן את הנתונים כדי לראות את תנועות המחיר ונפח המסחר בסקטורים המרכזיים.</p>
                  <button className="empty-rich-cta" onClick={fetchFlow}>
                    עדכון הסקטורים <span aria-hidden="true">→</span>
                  </button>
                </>
              ) : (
                <>
                  <span className="empty-rich-kicker">פעילות שוק לפי סקטור</span>
                  <h3>ראה מה קורה בסקטורים השונים.</h3>
                  <p>התחבר כדי לראות את תנועות המחיר ונפח המסחר בסקטורים המרכזיים.</p>
                  <div className="empty-rich-pills">
                    <span className="empty-rich-pill">כל הסקטורים</span>
                    <span className="empty-rich-pill">נתוני שוק</span>
                  </div>
                  <button className="empty-rich-cta" onClick={onCreateAccount || onSignIn}>
                    יצירת חשבון <span aria-hidden="true">→</span>
                  </button>
                  <div className="empty-rich-signin">
                    <span>כבר יש לך חשבון?</span>{' '}
                    <button type="button" onClick={onSignIn}>
                      התחברות
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
          label="פעילות שוק לפי סקטור"
          statusMessages={[
            'טוענים נתוני שוק…',
            'בודקים שינויי מחיר ונפח מסחר…',
            'מסכמים פעילות לפי סקטור…',
            'מכינים את תוצאות הסקטורים…',
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
                  <h2>כל הסקטורים</h2>
                  <span className="table-bar-sub">
                    {inflows.length} פעילות חיובית · {outflows.length} פעילות שלילית · {neutrals.length} ללא שינוי בולט
                  </span>
                </div>
                <span className="table-bar-count">{flowData.length} סקטורים</span>
              </div>
              <MobileResultSort
                options={[
                  { value: 'symbol', label: 'סימול' },
                  { value: 'sector', label: 'סקטור' },
                  { value: 'price', label: 'מחיר' },
                  { value: 'change', label: 'שינוי' },
                  { value: 'volRatio', label: 'יחס נפח' },
                  { value: 'flow', label: 'פעילות' },
                ]}
                value={flowSort}
                direction={flowSortDir}
                onSort={handleFlowSort}
              />
              <div className="table-wrap">
                <table className="results-table money-flow-results-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <FTH label="סימול" field="symbol" />
                      <FTH label="סקטור" field="sector" />
                      <FTH label="מחיר" field="price" />
                      <FTH label="שינוי באחוזים" field="change" />
                      <FTH label="יחס נפח" field="volRatio" />
                      <th>נפח מסחר</th>
                      <FTH label="פעילות" field="flow" />
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
                            sectorName(d.sector) || (etf && etf.name) || d.symbol
                          ),
                          React.createElement('td', { dir: 'ltr' }, formatPrice(d.price)),
                          React.createElement(
                            'td',
                            { className: d.change == null ? '' : d.change >= 0 ? 'col-pos' : 'col-neg', dir: 'ltr' },
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
                                dir: 'ltr',
                              },
                              formatRatio(d.volRatio)
                            )
                          ),
                          React.createElement(
                            'td',
                            { style: { color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 12 }, dir: 'ltr' },
                            fmt(d.volume)
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement('span', { className: 'flow-badge ' + d.flow }, flowLabel(d.flow))
                          ),
                          React.createElement(
                            'td',
                            {
                              className: 'result-row-actions',
                              onClick: (e) => e.stopPropagation(),
                            },
                            React.createElement(
                              'div',
                              { className: 'result-row-actions-inner' },
                              React.createElement(
                                'a',
                                {
                                  className: 'chart-open-btn',
                                  href: 'https://www.tradingview.com/chart/?symbol=' + d.symbol,
                                  target: '_blank',
                                  rel: 'noopener noreferrer',
                                  title: 'פתיחה ב־TradingView',
                                  'aria-label': 'פתיחה ב־TradingView',
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
                                  className:
                                    'alert-create-btn' + (alertLevels && alertLevels[d.symbol] ? ' active' : ''),
                                  onClick: () => promptCreateAlert(d.symbol),
                                  title:
                                    alertLevels && alertLevels[d.symbol]
                                      ? 'התראה מוגדרת ב־' + alertLevels[d.symbol] + 'x — לחיצה לעריכה'
                                      : 'יצירת התראת נפח',
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
                                React.createElement('span', { className: 'holdings-title' }, 'החזקות מובילות'),
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
                          <span className="mobile-card-name">
                            {sectorName(d.sector) || (etf && etf.name) || d.symbol}
                          </span>
                        </div>
                        <div className="mobile-result-card-actions">
                          <a
                            className="chart-open-btn"
                            href={'https://www.tradingview.com/chart/?symbol=' + d.symbol}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="פתיחה ב־TradingView"
                            aria-label={'פתיחת ' + d.symbol + ' ב־TradingView'}
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
                                ? 'התראה מוגדרת ב־' + alertLevels[d.symbol] + 'x — לחיצה לעריכה'
                                : 'יצירת התראת נפח'
                            }
                            aria-label={'יצירת התראת נפח עבור ' + d.symbol}
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
                          <span className="mobile-result-card-label">מחיר</span>
                          <span className="mobile-card-price">
                            <bdi dir="ltr">{formatPrice(d.price)}</bdi>
                          </span>
                        </div>
                        <div className="mobile-result-card-quote-item mobile-result-card-quote-item-end">
                          <span className="mobile-result-card-label">שינוי</span>
                          <span
                            className={'mobile-card-change ' + (d.change == null ? '' : d.change >= 0 ? 'pos' : 'neg')}
                          >
                            <bdi dir="ltr">{formatSignedPercent(d.change, 2)}</bdi>
                          </span>
                        </div>
                      </div>
                      <div className="mobile-result-card-grid">
                        <div className="mobile-result-card-stat">
                          <span className="mobile-result-card-label">יחס נפח</span>
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
                            <bdi dir="ltr">{formatRatio(d.volRatio)}</bdi>
                          </span>
                        </div>
                        <div className="mobile-result-card-stat">
                          <span className="mobile-result-card-label">נפח</span>
                          <span className="mobile-result-card-value">
                            <bdi dir="ltr">{fmt(d.volume)}</bdi>
                          </span>
                        </div>
                        <div className="mobile-result-card-stat">
                          <span className="mobile-result-card-label">פעילות</span>
                          <span className={'flow-badge ' + d.flow}>{flowLabel(d.flow)}</span>
                        </div>
                        <div className="mobile-result-card-stat mobile-result-card-stat-wide">
                          <span className="mobile-result-card-label">סקטור</span>
                          <span className="mobile-result-card-sector-name">
                            {sectorName(d.sector) || (etf && etf.name) || d.symbol}
                          </span>
                        </div>
                      </div>
                      {etf && etf.holdings && etf.holdings.length > 0 && (
                        <>
                          <button
                            className="flow-mobile-holdings-toggle"
                            onClick={() => setExpandedETF(open ? null : d.symbol)}
                            aria-expanded={open}
                          >
                            {open ? 'הסתרת ההחזקות המובילות' : 'הצגת ההחזקות המובילות'}
                            <span aria-hidden="true">{open ? '−' : '+'}</span>
                          </button>
                          {open && (
                            <div className="flow-mobile-holdings" aria-label="החזקות מובילות">
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
            </div>
          );
        })()}
    </div>
  );
}
