import React from 'react'
import { fmt } from '../../utils/format'

var SCAN_LABEL = { capitalFlow: 'Capital Flow', maScanner: 'MA Scanner', sectorMoving: 'Hot Sectors' }

function formatWhen(unixSec) {
  if (!unixSec) return ''
  return new Date(unixSec * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* Shown when a scheduled scan's push/bell notification is tapped — the exact
   results that scan found, not the current (possibly empty or unrelated)
   page. Works across all three scan types since capitalFlow/sectorMoving
   (scanTickers) and maScanner (scanMA) share enough of a shape: symbol,
   name, price, change, marketCap, plus either volumeRatio or maDistance as
   the "why it showed up" signal. */
export default function ScheduledScanResultsModal({ notification, onClose, openChart, isInWatchlist, toggleWatchlistTicker }) {
  if (!notification) return null
  var results = notification.results || []
  var label = SCAN_LABEL[notification.scanType] || 'Scheduled Scan'

  return (
    <div className="upgrade-overlay scheduled-results-overlay" onClick={onClose}>
      <div
        className="scheduled-results-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label + ' results'}
      >
        <div className="scheduled-results-header">
          <div>
            <h2 className="scheduled-results-title">{label} — {formatWhen(notification.createdAt)}</h2>
            <p className="scheduled-results-sub">{notification.body}</p>
          </div>
          <button className="scheduled-results-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {results.length === 0 ? (
          <div className="scheduled-results-empty">No unusual activity was found on this run.</div>
        ) : (
          <div className="scheduled-results-list">
            {results.map(function (r) {
              var hasRatio = typeof r.volumeRatio === 'number'
              return (
                <div key={r.symbol} className="scheduled-results-row">
                  <div className="scheduled-results-row-main">
                    <span className="scheduled-results-symbol">{r.symbol}</span>
                    {r.name && <span className="scheduled-results-name">{r.name}</span>}
                  </div>
                  <div className="scheduled-results-row-stats">
                    <span>{'$' + (r.price || 0).toFixed(2)}</span>
                    <span className={r.change >= 0 ? 'col-pos' : 'col-neg'}>
                      {(r.change >= 0 ? '+' : '') + (r.change || 0).toFixed(2) + '%'}
                    </span>
                    {hasRatio ? (
                      <span className={'ratio-pill ' + (r.volumeRatio >= 5 ? 'hot' : r.volumeRatio >= 3.5 ? 'warm' : 'ok')}>
                        {r.volumeRatio + 'x'}
                      </span>
                    ) : typeof r.maDistance === 'number' ? (
                      <span className="scheduled-results-ma">
                        {(r.direction === 'above' ? '+' : '') + r.maDistance + '% from MA'}
                      </span>
                    ) : null}
                    {r.marketCap > 0 && <span className="scheduled-results-cap">{fmt(r.marketCap)}</span>}
                  </div>
                  <div className="scheduled-results-row-actions">
                    {openChart && (
                      <button className="chart-open-btn" onClick={() => openChart(r.symbol, r.name)} title="Chart" aria-label={'Open chart for ' + r.symbol}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="20" x2="18" y2="10" />
                          <line x1="12" y1="20" x2="12" y2="4" />
                          <line x1="6" y1="20" x2="6" y2="14" />
                        </svg>
                      </button>
                    )}
                    {toggleWatchlistTicker && (
                      <button
                        className={'star-btn-remove' + (isInWatchlist && isInWatchlist(r.symbol) ? ' active' : '')}
                        onClick={() => toggleWatchlistTicker(r.symbol)}
                        title={isInWatchlist && isInWatchlist(r.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                        aria-label={(isInWatchlist && isInWatchlist(r.symbol) ? 'Remove ' : 'Add ') + r.symbol + ' watchlist'}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill={isInWatchlist && isInWatchlist(r.symbol) ? 'var(--accent)' : 'none'} stroke={isInWatchlist && isInWatchlist(r.symbol) ? 'var(--accent)' : 'var(--text-3)'} strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
