import React, { useState } from 'react'
import { fmt } from '../../utils/format'
import AddTickerModal from './AddTickerModal'

function StarIcon({ starred }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill={starred ? 'var(--accent)' : 'none'}
      stroke={starred ? 'var(--accent)' : 'var(--text-3)'}
      strokeWidth="2"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function RatioPill({ ratio }) {
  if (!(ratio > 0)) return '—'
  const cls = ratio >= 5 ? 'hot' : ratio >= 2 ? 'warm' : 'ok'
  return <span className={'ratio-pill ' + cls}>{ratio + 'x'}</span>
}

// iOS Safari only exposes the Push API to sites added to the Home Screen
// (display: standalone) — there is no way to enable push from a regular
// Safari tab, so "not supported" there actually means "not installed yet".
function isIosNotInstalled() {
  if (typeof navigator === 'undefined') return false
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  return isIos && !isStandalone
}

function ChartLink({ symbol }) {
  return (
    <a
      className="chart-open-btn"
      href={'https://www.tradingview.com/chart/?symbol=' + symbol}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in TradingView"
      aria-label={'Open ' + symbol + ' in TradingView'}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M18.7 8l-5.1 5.1-4-4L3 15.6" />
      </svg>
    </a>
  )
}

function AlertButton({ symbol, alertLevels, promptCreateAlert }) {
  const level = alertLevels && alertLevels[symbol]
  return (
    <button
      className={'alert-create-btn' + (level ? ' active' : '')}
      onClick={() => promptCreateAlert(symbol)}
      title={level ? 'Alert set at ' + level + 'x — click to edit' : 'Create a volume alert'}
      aria-label={level ? 'Edit alert for ' + symbol : 'Create a volume alert for ' + symbol}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    </button>
  )
}

export default function WatchlistPage({
  watchlist,
  watchlistData,
  watchlistLoading,
  watchlistError,
  refreshWatchlist,
  toggleWatchlistTicker,
  setWatchlistError,
  isElite,
  canNotify,
  user,
  pushSupported,
  pushEnabled,
  pushBusy,
  pushError,
  enablePush,
  disablePush,
  notifTime,
  saveNotifTime,
  setShowUpgradeModal,
  getToken,
  onAccountDeleted,
  alertLevels,
  promptCreateAlert,
}) {
  const [showAddModal, setShowAddModal] = useState(false)

  function findQuote(sym) {
    return watchlistData ? watchlistData.find((r) => r.symbol === sym) : null
  }

  return (
    <div className="page-content">
      <div className="flow-header">
        <div>
          <h2 className="flow-title">Watchlist</h2>
          <p className="flow-sub">Track your favorite tickers across sessions</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {watchlist.length > 0 && (
            <button className="scan-btn" onClick={refreshWatchlist} disabled={watchlistLoading}>
              {watchlistLoading ? <><div className="spinner" /> Refreshing...</> : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Notification Settings — push + alert thresholds are Elite, or a
          free account still inside its 7-day trial (canNotify). The daily
          scheduled digest below stays strictly Elite (isElite). */}
      {user && !canNotify && (
        <div className="notif-settings-panel notif-settings-upsell">
          <div className="notif-settings-row">
            <div>
              <div className="notif-settings-title">Push Notifications &amp; Scheduled Scans</div>
              <div className="notif-settings-sub">
                Elite feature — get notified the instant a ticker crosses your threshold, even with the app closed.
              </div>
            </div>
            <button className="notif-toggle-btn" onClick={() => setShowUpgradeModal(true)}>
              Upgrade to Elite
            </button>
          </div>
        </div>
      )}

      {canNotify && (
        <div className="notif-settings-panel">
          <div className="notif-settings-row">
            <div>
              <div className="notif-settings-title">Push Notifications</div>
              <div className="notif-settings-sub">
                Get notified the moment a watchlist ticker crosses its alert threshold — even when the app is closed.
              </div>
            </div>
            {!pushSupported ? (
              isIosNotInstalled() ? (
                <span className="notif-settings-unsupported">
                  Tap Share → &quot;Add to Home Screen&quot; to enable notifications on iPhone
                </span>
              ) : (
                <span className="notif-settings-unsupported">Not supported in this browser</span>
              )
            ) : (
              <button
                className={'notif-toggle-btn' + (pushEnabled ? ' on' : '')}
                onClick={pushEnabled ? disablePush : enablePush}
                disabled={pushBusy}
              >
                {pushBusy ? '...' : pushEnabled ? 'Enabled' : 'Enable'}
              </button>
            )}
          </div>
          {pushError && <div className="notif-settings-error">{pushError}</div>}
          {isElite && pushSupported && pushEnabled && (
            <div className="notif-settings-row">
              <div>
                <div className="notif-settings-title">Daily Scan Time</div>
                <div className="notif-settings-sub">
                  Pick a time (Israel time) — the app scans on its own and sends you a summary, no need to open it.
                </div>
              </div>
              <input
                type="time"
                className="notif-time-input"
                value={notifTime}
                onChange={(e) => saveNotifTime(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {showAddModal && (
        <AddTickerModal
          watchlist={watchlist}
          onAdd={(sym) => toggleWatchlistTicker(sym)}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {watchlistError && (
        <div className="error-bar error-bar-action">
          <div className="error-bar-content">
            <span>{watchlistError}</span>
          </div>
          <div className="error-bar-actions">
            <button className="error-retry-btn" onClick={refreshWatchlist}>
              Retry
            </button>
            <button className="error-dismiss-btn" onClick={() => setWatchlistError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {watchlist.length === 0 ? (
        <div className="empty-rich">
          <div className="empty-rich-skeleton">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div className="empty-rich-skeleton-card" key={i}>
                <div className="empty-rich-skeleton-bar-label" />
                <div className={'empty-rich-skeleton-bar-value' + (i % 2 === 0 ? ' accent' : '')} />
              </div>
            ))}
          </div>
          <div className="empty-rich-overlay">
            <div className="empty-rich-card">
              <div className="empty-rich-icon">
                <img src="/icon-192.png" alt="" />
              </div>
              <h3>Your Watchlist</h3>
              <p>STAR ANY TICKER TO TRACK IT ACROSS EVERY SESSION</p>
              <div className="empty-rich-pills">
                <span className="empty-rich-pill">SAVED ACROSS SESSIONS</span>
                <span className="empty-rich-pill">LIVE QUOTES</span>
                <span className="empty-rich-pill">ONE-TAP ADD</span>
              </div>
              <button className="empty-rich-cta" onClick={() => setShowAddModal(true)}>
                + Add Ticker
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-bar">
            <div>
              <h2>{watchlist.length + ' Ticker' + (watchlist.length !== 1 ? 's' : '')}</h2>
              <span className="table-bar-sub">
                {watchlistData ? 'Last refreshed ' + new Date().toLocaleTimeString() : 'Click Refresh to load latest quotes'}
              </span>
            </div>
            <button className="scan-btn add-ticker-btn" onClick={() => setShowAddModal(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Ticker
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Change</th>
                  <th>Vol Ratio</th>
                  <th>Mkt Cap</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((sym) => {
                  const d = findQuote(sym)
                  return (
                    <tr key={sym}>
                      <td className="col-ticker">
                        <div className="ticker-cell">
                          <img
                            className="ticker-logo"
                            src={'https://assets.parqet.com/logos/symbol/' + sym}
                            alt=""
                            width={18}
                            height={18}
                            onError={(e) => {
                              e.target.style.display = 'none'
                            }}
                          />
                          {sym}
                        </div>
                      </td>
                      {d ? (
                        <>
                          <td className="col-name">{d.name}</td>
                          <td>{'$' + d.price.toFixed(2)}</td>
                          <td className={d.change >= 0 ? 'col-pos' : 'col-neg'}>
                            {(d.change >= 0 ? '+' : '') + d.change.toFixed(2) + '%'}
                          </td>
                          <td>
                            <RatioPill ratio={d.volumeRatio} />
                          </td>
                          <td>{d.marketCap ? fmt(d.marketCap) : '—'}</td>
                        </>
                      ) : watchlistLoading ? (
                        <>
                          <td>
                            <span className="skel skel-text" />
                          </td>
                          <td>
                            <span className="skel skel-num" />
                          </td>
                          <td>
                            <span className="skel skel-num" />
                          </td>
                          <td>
                            <span className="skel skel-pill" />
                          </td>
                          <td>
                            <span className="skel skel-num" />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="col-name" style={{ color: 'var(--text-3)' }}>
                            {watchlistData ? 'Not found' : '—'}
                          </td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                        </>
                      )}
                      <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <ChartLink symbol={sym} />
                        <AlertButton symbol={sym} alertLevels={alertLevels} promptCreateAlert={promptCreateAlert} />
                        <button
                          className="star-btn-remove"
                          onClick={() => toggleWatchlistTicker(sym)}
                          title="Remove"
                          aria-label={'Remove ' + sym + ' from watchlist'}
                        >
                          {'\xd7'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile watchlist cards */}
          <div className="mobile-cards">
            {watchlist.map((sym) => {
              const d = findQuote(sym)
              return (
                <div key={sym} className="mobile-card ratio-ok">
                  <div className="mobile-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <span className="mobile-card-ticker">{sym}</span>
                      {d && <span className="mobile-card-name">{d.name}</span>}
                      {!d && watchlistLoading && <span className="skel skel-text" />}
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <ChartLink symbol={sym} />
                      <AlertButton symbol={sym} alertLevels={alertLevels} promptCreateAlert={promptCreateAlert} />
                      <button
                        className="star-btn-remove"
                        onClick={() => toggleWatchlistTicker(sym)}
                        aria-label={'Remove ' + sym + ' from watchlist'}
                      >
                        {'\xd7'}
                      </button>
                    </div>
                  </div>
                  {d && (
                    <div className="mobile-card-mid">
                      <span className="mobile-card-price">{'$' + d.price.toFixed(2)}</span>
                      <span className={'mobile-card-change ' + (d.change >= 0 ? 'pos' : 'neg')}>
                        {(d.change >= 0 ? '+' : '') + d.change.toFixed(2) + '%'}
                      </span>
                    </div>
                  )}
                  {!d && watchlistLoading && (
                    <div className="mobile-card-mid">
                      <span className="skel skel-num" />
                      <span className="skel skel-num" />
                    </div>
                  )}
                  {d && (
                    <div className="mobile-card-bottom">
                      <span className="mobile-card-ratio">
                        <RatioPill ratio={d.volumeRatio} />
                      </span>
                      <span className="mobile-card-vol">{d.marketCap ? fmt(d.marketCap) : ''}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {watchlistLoading && <div className="table-footer">Loading quotes...</div>}
        </div>
      )}
    </div>
  )
}
