import React from 'react';
import { fmt, formatPrice, formatRatio, formatSignedPercent } from '../../utils/format';
import useModalA11y from '../../hooks/useModalA11y';
import { SECTOR_ETFS } from '../../constants';
import { flowLabel } from '../../utils/marketCopy';
import ShareScanResults from './ShareScanResults';

const SECTOR_BY_TICKER = Object.fromEntries(SECTOR_ETFS.map((sector) => [sector.ticker, sector]));

var SCAN_LABEL = {
  capitalFlow: 'נפח חריג',
  maScanner: 'ממוצעים נעים',
  sectorMoving: 'פעילות בסקטורים',
  capitalFlowRadar: 'Capital Flow Radar',
};

function formatWhen(unixSec) {
  if (typeof unixSec !== 'number' || !Number.isFinite(unixSec) || unixSec <= 0) return '';
  return new Date(unixSec * 1000).toLocaleString('he-IL', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasNumber(value) {
  return (
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
  );
}

function dataTime(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  var timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 60000) return '';
  return formatWhen(timestamp / 1000);
}

/* Push and bell clicks show the saved run, never a fresh scan. Hot Sectors
   snapshots contain sector ETFs, not the stock scanner's result shape. */
export default function ScheduledScanResultsModal(props) {
  if (!props.notification) return null;
  return <ScheduledScanResultsPanel {...props} />;
}

function ScheduledScanResultsPanel({ notification, onClose, isInWatchlist, toggleWatchlistTicker }) {
  const panelRef = useModalA11y(onClose);
  var results = Array.isArray(notification.results) ? notification.results : [];
  var isSectorScan = notification.scanType === 'sectorMoving';
  // Older releases incorrectly saved stock scans as Hot Sectors. Those
  // historical sector results cannot be reconstructed from today's data.
  var legacySectorScan =
    isSectorScan &&
    results.some(
      (row) => !SECTOR_BY_TICKER[row?.symbol] || !['inflow', 'outflow', 'neutral', 'unavailable'].includes(row?.flow)
    );
  var label = SCAN_LABEL[notification.scanType] || 'סריקה מתוזמנת';
  var reportType = isSectorScan
    ? 'sectorMoving'
    : notification.scanType === 'maScanner'
      ? 'movingAverage'
      : 'capitalFlow';
  var observedAt = dataTime(notification.dataAsOf);
  var qualityNotice =
    notification.dataStatus === 'partial'
      ? 'מוצגות התוצאות הזמינות. חלק מנתוני השוק לא היו זמינים.'
      : notification.dataStatus === 'stale'
        ? 'התוצאות השמורות מבוססות על נתונים מעוכבים.'
        : notification.dataStatus !== 'complete'
          ? 'לא הצלחנו לאמת את התוצאות השמורות במלואן.'
          : '';

  return (
    <div className="upgrade-overlay scheduled-results-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={'scheduled-results-modal' + (isSectorScan ? ' scheduled-sector-results-modal' : '')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label + ' — תוצאות'}
      >
        <div className="scheduled-results-header">
          <div>
            <h2 className="scheduled-results-title">
              {label} — {formatWhen(notification.createdAt)}
            </h2>
            <p className="scheduled-results-sub">
              {legacySectorScan
                ? 'ההתראה הישנה הזו לא כוללת סריקת סקטורים שמורה.'
                : results.length > 0
                  ? 'זוהה אות חדש בשוק. אפשר לפתוח את Capital Flow כדי לראות אותו.'
                  : 'הפעם לא הצלחנו לאמת אות בשוק.'}
            </p>
            {results.length > 0 && !legacySectorScan && (
              <div className="scheduled-results-quality" role="note">
                {qualityNotice && <p>{qualityNotice}</p>}
                <p>{observedAt ? 'נתוני שוק נכון ל-' + observedAt + '.' : 'זמן נתוני השוק אינו זמין.'}</p>
              </div>
            )}
          </div>
          <div className="table-bar-right">
            {results.length > 0 && !legacySectorScan && (
              <ShareScanResults
                key={notification.id ?? notification.createdAt}
                report={{
                  type: reportType,
                  title: label + ' scheduled scan results',
                  rows: results,
                  scanTime: notification.createdAt > 0 ? new Date(notification.createdAt * 1000) : null,
                  dataAsOf: observedAt ? notification.dataAsOf : null,
                  dataStatus: notification.dataStatus,
                }}
              />
            )}
            <button className="scheduled-results-close" onClick={onClose} aria-label="סגירה">
              &times;
            </button>
          </div>
        </div>

        {legacySectorScan ? (
          <div className="scheduled-results-empty">
            <a className="btn-secondary" href="/flow" onClick={onClose}>
              לפתיחת פעילות בסקטורים והרצת סריקה חדשה
            </a>
          </div>
        ) : results.length === 0 ? (
          <div className="scheduled-results-empty">{'הפעם לא הצלחנו לאמת אות בשוק.'}</div>
        ) : (
          <div className="scheduled-results-list">
            <div className="scheduled-results-col-header">
              <span>{isSectorScan ? 'סקטור' : 'סימול'}</span>
              <span>{isSectorScan ? 'פעילות' : 'שווי שוק'}</span>
              <span>מחיר</span>
              <span>שינוי</span>
              <span>{isSectorScan ? 'יחס נפח' : 'אות'}</span>
              <span></span>
            </div>
            {results.map(function (r) {
              var ratio = isSectorScan ? r.volRatio : r.volumeRatio;
              var hasRatio = hasNumber(ratio) && Number(ratio) > 0;
              var hasMaDistance = hasNumber(r.maDistance);
              var sector = isSectorScan && SECTOR_BY_TICKER[r.symbol];
              return (
                <div key={r.symbol} className="scheduled-results-row">
                  <div className="scheduled-results-row-main">
                    <span className="scheduled-results-symbol">{sector ? sector.name : r.symbol}</span>
                    {(sector || r.name) && <span className="scheduled-results-name">{sector ? r.symbol : r.name}</span>}
                  </div>
                  <span className="scheduled-results-cap" data-label={isSectorScan ? 'פעילות' : 'שווי שוק'}>
                    {isSectorScan ? (
                      <span className={'flow-badge ' + r.flow}>{flowLabel(r.flow)}</span>
                    ) : r.marketCap > 0 ? (
                      fmt(r.marketCap)
                    ) : (
                      '—'
                    )}
                  </span>
                  <span className="scheduled-results-price" data-label="מחיר">
                    <bdi dir="ltr">{formatPrice(r.price)}</bdi>
                  </span>
                  <span
                    className={
                      'scheduled-results-change ' + (r.change == null ? '' : r.change >= 0 ? 'col-pos' : 'col-neg')
                    }
                    data-label="שינוי"
                  >
                    <bdi dir="ltr">{formatSignedPercent(r.change)}</bdi>
                  </span>
                  <span className="scheduled-results-signal" data-label={isSectorScan ? 'יחס נפח' : 'אות'}>
                    {hasRatio ? (
                      <span
                        className={
                          'ratio-pill ' +
                          (ratio >= (isSectorScan ? 2 : 5)
                            ? 'hot'
                            : ratio >= (isSectorScan ? 1.2 : 3.5)
                              ? 'warm'
                              : 'ok')
                        }
                      >
                        <bdi dir="ltr">{formatRatio(ratio)}</bdi>
                      </span>
                    ) : !isSectorScan && hasMaDistance ? (
                      <span className="scheduled-results-ma">
                        {(r.direction === 'above' ? '+' : '') + Number(r.maDistance).toFixed(2) + '% מהממוצע'}
                      </span>
                    ) : isSectorScan ? (
                      '—'
                    ) : null}
                  </span>
                  <div className="scheduled-results-row-actions">
                    <a
                      className="chart-open-btn"
                      href={'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(r.symbol)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="פתיחה ב-TradingView"
                      aria-label={'פתיחת ' + r.symbol + ' ב-TradingView'}
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
                    {toggleWatchlistTicker && (
                      <button
                        className={'star-btn-remove' + (isInWatchlist && isInWatchlist(r.symbol) ? ' active' : '')}
                        onClick={() => toggleWatchlistTicker(r.symbol)}
                        title={isInWatchlist && isInWatchlist(r.symbol) ? 'הסרה מרשימת המעקב' : 'הוספה לרשימת המעקב'}
                        aria-label={
                          (isInWatchlist && isInWatchlist(r.symbol) ? 'הסרת ' : 'הוספת ') + r.symbol + ' לרשימת המעקב'
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill={isInWatchlist && isInWatchlist(r.symbol) ? 'var(--accent)' : 'none'}
                          stroke={isInWatchlist && isInWatchlist(r.symbol) ? 'var(--accent)' : 'var(--text-3)'}
                          strokeWidth="2"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
