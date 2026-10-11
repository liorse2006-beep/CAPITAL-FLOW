import React from 'react';
import { fmt, formatPrice, formatRatio, formatSignedPercent } from '../../utils/format';
import useModalA11y from '../../hooks/useModalA11y';

var SCAN_LABEL = {
  capitalFlow: 'Capital Flow',
  maScanner: 'סורק ממוצעים נעים',
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

/* Shown when a scheduled scan's push/bell notification is tapped — the exact
   results that scan found, not the current (possibly empty or unrelated)
   page. Works across all three scan types since capitalFlow/sectorMoving
   (scanTickers) and maScanner (scanMA) share enough of a shape: symbol,
   name, price, change, marketCap, plus either volumeRatio or maDistance as
   the "why it showed up" signal. */
export default function ScheduledScanResultsModal(props) {
  if (!props.notification) return null;
  return <ScheduledScanResultsPanel {...props} />;
}

function ScheduledScanResultsPanel({ notification, onClose, isInWatchlist, toggleWatchlistTicker }) {
  const panelRef = useModalA11y(onClose);
  var results = Array.isArray(notification.results) ? notification.results : [];
  var label = SCAN_LABEL[notification.scanType] || 'סריקה מתוזמנת';
  var observedAt = dataTime(notification.dataAsOf);
  var qualityNotice =
    notification.dataStatus === 'partial'
      ? 'מוצגות התוצאות הזמינות. חלק מנתוני השוק חסרים.'
      : notification.dataStatus === 'stale'
        ? 'התוצאות השמורות מבוססות על נתונים מעוכבים.'
        : notification.dataStatus !== 'complete'
          ? 'לא ניתן היה לאמת את כל הנתונים בתוצאות השמורות.'
          : '';

  return (
    <div className="upgrade-overlay scheduled-results-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="scheduled-results-modal"
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
              {results.length > 0
                ? 'New market signal detected. Open Capital Flow to view it.'
                : "We couldn't verify a market signal this time."}
            </p>
            {results.length > 0 && (
              <div className="scheduled-results-quality" role="note">
                {qualityNotice && <p>{qualityNotice}</p>}
                <p>{observedAt ? 'נתוני שוק נכון ל־' + observedAt + '.' : 'מועד נתוני השוק אינו זמין.'}</p>
              </div>
            )}
          </div>
          <button className="scheduled-results-close" onClick={onClose} aria-label="סגירה">
            &times;
          </button>
        </div>

        {results.length === 0 ? (
          <div className="scheduled-results-empty">{"We couldn't verify a market signal this time."}</div>
        ) : (
          <div className="scheduled-results-list">
            <div className="scheduled-results-col-header">
              <span>מניה</span>
              <span>שווי שוק</span>
              <span>מחיר</span>
              <span>שינוי</span>
              <span>סיבת התאמה</span>
              <span></span>
            </div>
            {results.map(function (r) {
              var hasRatio = hasNumber(r.volumeRatio) && Number(r.volumeRatio) > 0;
              var hasMaDistance = hasNumber(r.maDistance);
              return (
                <div key={r.symbol} className="scheduled-results-row">
                  <div className="scheduled-results-row-main">
                    <span className="scheduled-results-symbol">{r.symbol}</span>
                    {r.name && <span className="scheduled-results-name">{r.name}</span>}
                  </div>
                  <span className="scheduled-results-cap" data-label="שווי שוק">
                    {r.marketCap > 0 ? fmt(r.marketCap) : '—'}
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
                  <span className="scheduled-results-signal" data-label="סיבת התאמה">
                    {hasRatio ? (
                      <span
                        className={'ratio-pill ' + (r.volumeRatio >= 5 ? 'hot' : r.volumeRatio >= 3.5 ? 'warm' : 'ok')}
                      >
                        <bdi dir="ltr">{formatRatio(r.volumeRatio)}</bdi>
                      </span>
                    ) : hasMaDistance ? (
                      <span className="scheduled-results-ma">
                        {(r.direction === 'above' ? '+' : '') + Number(r.maDistance).toFixed(2) + '% מהממוצע'}
                      </span>
                    ) : null}
                  </span>
                  <div className="scheduled-results-row-actions">
                    <a
                      className="chart-open-btn"
                      href={'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(r.symbol)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="פתיחה ב־TradingView"
                      aria-label={'פתיחת ' + r.symbol + ' ב־TradingView'}
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
                          (isInWatchlist && isInWatchlist(r.symbol) ? 'הסרת ' : 'הוספת ') + r.symbol + ' ברשימת המעקב'
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
