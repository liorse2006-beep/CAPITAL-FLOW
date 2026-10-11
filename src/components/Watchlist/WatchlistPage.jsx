import React, { useState } from 'react';
import { fmt, alertLevelLabel, formatSignedPercent, formatPrice, friendlyError } from '../../utils/format';
import useSeo from '../../hooks/useSeo';
import AddTickerModal from './AddTickerModal';

function RatioPill({ ratio }) {
  if ((typeof ratio !== 'number' && typeof ratio !== 'string') || !Number.isFinite(Number(ratio)) || !(ratio > 0))
    return '—';
  const cls = ratio >= 5 ? 'hot' : ratio >= 2 ? 'warm' : 'ok';
  return <span className={'ratio-pill ' + cls}>{ratio + 'x'}</span>;
}

// iOS Safari only exposes the Push API to sites added to the Home Screen
// (display: standalone) — there is no way to enable push from a regular
// Safari tab, so "not supported" there actually means "not installed yet".
function isIosNotInstalled() {
  if (typeof navigator === 'undefined') return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return isIos && !isStandalone;
}

function ChartLink({ symbol }) {
  return (
    <a
      className="chart-open-btn"
      href={'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(symbol)}
      target="_blank"
      rel="noopener noreferrer"
      title="פתיחה ב־TradingView"
      aria-label={'פתיחת ' + symbol + ' ב־TradingView'}
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
  );
}

function AlertButton({ symbol, price, alertLevels, promptCreateAlert }) {
  const level = alertLevels && alertLevels[symbol];
  return (
    <button
      className={'alert-create-btn' + (level ? ' active' : '')}
      onClick={() => promptCreateAlert(symbol, price)}
      title={level ? 'התראה מוגדרת ב־' + alertLevelLabel(level) + ' — לחיצה לעריכה' : 'יצירת התראה'}
      aria-label={level ? 'עריכת התראה עבור ' + symbol : 'יצירת התראה עבור ' + symbol}
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
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
  );
}

export default function WatchlistPage({
  watchlist,
  watchlistData,
  watchlistDataAsOf,
  watchlistQuoteStatus,
  watchlistLoading,
  watchlistError,
  refreshWatchlist,
  toggleWatchlistTicker,
  setWatchlistError,
  canNotify,
  user,
  pushSupported,
  pushEnabled,
  pushBusy,
  pushError,
  enablePush,
  disablePush,
  setShowUpgradeModal,
  alertLevels,
  promptCreateAlert,
  onRequireAuth,
  onCreateAccount,
}) {
  useSeo({
    title: 'רשימת מעקב והתראות | Capital Flow',
    description: 'מעקב אחר מניות, מחירים והתראות מחיר או נפח מסחר. נתוני השוק עשויים להיות מעוכבים או חלקיים.',
    path: '/watchlist',
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const asOf = typeof watchlistDataAsOf === 'string' ? Date.parse(watchlistDataAsOf) : NaN;
  const hasQuoteTime = Number.isFinite(asOf) && asOf > 0;

  function findQuote(sym) {
    return Array.isArray(watchlistData) ? watchlistData.find((r) => r && r.symbol === sym) : null;
  }

  return (
    <div className="page-content watchlist-page">
      <div className="flow-header">
        <div>
          <h2 className="flow-title">רשימת מעקב</h2>
          <p className="flow-sub">כל המניות שמעניינות אותך במקום אחד</p>
        </div>
      </div>

      {/* Notification Settings — push, alert thresholds AND the daily scan
          time are the full Elite feature set, granted to Elite and to any
          free account still inside its 7-day trial (canNotify). */}
      {user && !canNotify && (
        <div className="notif-settings-panel notif-settings-upsell">
          <div className="notif-settings-row">
            <div>
              <div className="notif-settings-title">התראות וסריקות מתוזמנות</div>
              <div className="notif-settings-sub">
                כלול במסלול Elite — קבלת התראה כשמניה עוברת את הסף שלך, גם כשהאפליקציה סגורה.
              </div>
            </div>
            <button className="notif-toggle-btn" onClick={() => setShowUpgradeModal(true)}>
              שדרוג ל־Elite
            </button>
          </div>
        </div>
      )}

      {canNotify && (
        <div className="notif-settings-panel">
          <div className="notif-settings-row">
            <div className="notif-settings-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="notif-settings-title">התראות למכשיר</div>
              <div className="notif-settings-sub">
                קבלת התראות כשמניה ברשימת המעקב עוברת את הסף שהגדרת — גם כשהאפליקציה סגורה.
              </div>
            </div>
            <div className="notif-settings-action">
              {!pushSupported ? (
                isIosNotInstalled() ? (
                  <span className="notif-settings-unsupported">
                    באייפון: שיתוף ← הוספה למסך הבית. יש לפתוח משם ולהפעיל התראות.
                  </span>
                ) : (
                  <span className="notif-settings-unsupported">התראות אינן נתמכות בדפדפן הזה</span>
                )
              ) : (
                <button
                  className={'notif-toggle-btn' + (pushEnabled ? ' on' : '')}
                  onClick={pushEnabled ? disablePush : enablePush}
                  disabled={pushBusy}
                >
                  {pushBusy ? '...' : pushEnabled ? 'מופעלות' : 'הפעלה'}
                </button>
              )}
            </div>
          </div>
          {pushError && <div className="notif-settings-error">{friendlyError(pushError)}</div>}
        </div>
      )}

      {showAddModal && (
        <AddTickerModal
          watchlist={watchlist}
          onAdd={(sym) => {
            if (!user) {
              onRequireAuth?.();
              return;
            }
            toggleWatchlistTicker(sym);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {watchlistError && (
        <div className="error-bar error-bar-action">
          <div className="error-bar-content">
            <span>{friendlyError(watchlistError)}</span>
          </div>
          <div className="error-bar-actions">
            <button className="error-retry-btn" onClick={refreshWatchlist}>
              ניסיון נוסף
            </button>
            <button className="error-dismiss-btn" onClick={() => setWatchlistError(null)}>
              סגירה
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
            <div className={'empty-rich-card' + (!user ? ' empty-rich-guest-card' : '')}>
              <div className="empty-rich-icon">
                <img src="/icon-192.png" alt="" />
              </div>
              {user ? (
                <>
                  <h3>רשימת המעקב שלך</h3>
                  <p>לחיצה על הכוכב לצד מניה שומרת אותה ברשימת המעקב</p>
                  <div className="empty-rich-pills">
                    <span className="empty-rich-pill">נשמר בחשבון שלך</span>
                    <span className="empty-rich-pill">מחירי מניות</span>
                    <span className="empty-rich-pill">הוספה בלחיצה</span>
                  </div>
                  <button className="empty-rich-cta" onClick={() => setShowAddModal(true)}>
                    + הוספת מניה
                  </button>
                </>
              ) : (
                <>
                  <span className="empty-rich-kicker">רשימת מעקב</span>
                  <h3>המניות שלך, תמיד בהישג יד.</h3>
                  <p>שמור מניות שמעניינות אותך, עקוב אחר המחירים והגדר התראות.</p>
                  <div className="empty-rich-pills">
                    <span className="empty-rich-pill">נשמר בחשבון שלך</span>
                    <span className="empty-rich-pill">מחירי מניות</span>
                    <span className="empty-rich-pill">הוספה בלחיצה</span>
                  </div>
                  <button className="empty-rich-cta" onClick={onCreateAccount || onRequireAuth}>
                    יצירת חשבון <span aria-hidden="true">→</span>
                  </button>
                  <div className="empty-rich-signin">
                    <span>כבר יש לך חשבון?</span>{' '}
                    <button type="button" onClick={onRequireAuth}>
                      התחברות
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="table-card watchlist-results">
          <div className="table-bar">
            <div>
              <h2>{watchlist.length + ' מניות'}</h2>
              <span className="table-bar-sub">
                {watchlistData ? (
                  hasQuoteTime ? (
                    <>
                      {watchlistQuoteStatus === 'stale' ? 'המחירים עשויים להיות מעוכבים · ' : 'מחירים נכון ל־'}
                      <time dateTime={watchlistDataAsOf}>{new Date(asOf).toLocaleString()}</time>
                    </>
                  ) : (
                    'מועד המחיר אינו זמין'
                  )
                ) : (
                  'לחץ על מחיר עדכני לטעינת המחירים'
                )}
              </span>
            </div>
            <div className="watchlist-actions">
              <button className="scan-btn active-price-btn" onClick={refreshWatchlist} disabled={watchlistLoading}>
                {watchlistLoading ? (
                  <>
                    <div className="spinner" /> מעדכנים…
                  </>
                ) : (
                  'מחיר עדכני'
                )}
              </button>
              <button className="scan-btn add-ticker-btn" onClick={() => setShowAddModal(true)}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                הוספת מניה
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="results-table watchlist-results-table">
              <thead>
                <tr>
                  <th>סימול</th>
                  <th>שם</th>
                  <th>מחיר</th>
                  <th>שינוי</th>
                  <th>יחס נפח</th>
                  <th>שווי שוק</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((sym) => {
                  const d = findQuote(sym);
                  return (
                    <tr key={sym}>
                      <td className="col-ticker">
                        <div className="ticker-cell">
                          <img
                            className="ticker-logo"
                            src={'https://assets.parqet.com/logos/symbol/' + sym + '?format=svg&size=32'}
                            alt=""
                            width={18}
                            height={18}
                            onError={(e) => {
                              e.target.style.display = 'none';
                            }}
                          />
                          {sym}
                        </div>
                      </td>
                      {d ? (
                        <>
                          <td className="col-name">{d.name}</td>
                          <td>
                            <bdi dir="ltr">{formatPrice(d.price)}</bdi>
                          </td>
                          <td className={d.change == null ? '' : d.change >= 0 ? 'col-pos' : 'col-neg'}>
                            <bdi dir="ltr">{formatSignedPercent(d.change)}</bdi>
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
                            {watchlistData ? 'מחיר אינו זמין' : '—'}
                          </td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                        </>
                      )}
                      <td className="result-row-actions">
                        <div className="result-row-actions-inner">
                          <ChartLink symbol={sym} />
                          <AlertButton
                            symbol={sym}
                            price={d && d.price}
                            alertLevels={alertLevels}
                            promptCreateAlert={promptCreateAlert}
                          />
                          <button
                            className="star-btn-remove"
                            onClick={() => toggleWatchlistTicker(sym)}
                            title="הסרה"
                            aria-label={'הסרת ' + sym + ' מרשימת המעקב'}
                          >
                            {'\xd7'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile watchlist cards */}
          <div className="mobile-cards mobile-result-list watchlist-result-list">
            {watchlist.map((sym) => {
              const d = findQuote(sym);
              return (
                <div key={sym} className="mobile-card mobile-result-card watchlist-result-card ratio-ok">
                  <div className="mobile-result-card-header">
                    <div className="mobile-result-card-identity">
                      <span className="mobile-result-card-rank" aria-hidden="true">
                        •
                      </span>
                      <img
                        className="ticker-logo"
                        src={'https://assets.parqet.com/logos/symbol/' + sym + '?format=svg&size=32'}
                        alt=""
                        width={18}
                        height={18}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                      <span className="mobile-card-ticker">{sym}</span>
                      {d && <span className="mobile-card-name">{d.name}</span>}
                      {!d && watchlistLoading && <span className="skel skel-text" />}
                    </div>
                    <div className="mobile-result-card-actions">
                      <ChartLink symbol={sym} />
                      <AlertButton
                        symbol={sym}
                        price={d && d.price}
                        alertLevels={alertLevels}
                        promptCreateAlert={promptCreateAlert}
                      />
                      <button
                        className="star-btn-remove"
                        onClick={() => toggleWatchlistTicker(sym)}
                        aria-label={'הסרת ' + sym + ' מרשימת המעקב'}
                      >
                        {'\xd7'}
                      </button>
                    </div>
                  </div>
                  {d && (
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
                          <bdi dir="ltr">{formatSignedPercent(d.change)}</bdi>
                        </span>
                      </div>
                    </div>
                  )}
                  {!d && watchlistLoading && (
                    <div className="mobile-card-mid">
                      <span className="skel skel-num" />
                      <span className="skel skel-num" />
                    </div>
                  )}
                  {!d && !watchlistLoading && watchlistData && <div className="mobile-card-mid">מחיר אינו זמין</div>}
                  {d && (
                    <div className="mobile-result-card-grid">
                      <div className="mobile-result-card-stat">
                        <span className="mobile-result-card-label">יחס נפח</span>
                        <RatioPill ratio={d.volumeRatio} />
                      </div>
                      <div className="mobile-result-card-stat">
                        <span className="mobile-result-card-label">שווי שוק</span>
                        <span className="mobile-result-card-value">{d.marketCap > 0 ? fmt(d.marketCap) : '—'}</span>
                      </div>
                      <div className="mobile-result-card-stat mobile-result-card-stat-wide">
                        <span className="mobile-result-card-label">שם</span>
                        <span className="mobile-result-card-sector-name">{d.name || '—'}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {watchlistLoading && <div className="table-footer">טוענים מחירים…</div>}
        </div>
      )}
    </div>
  );
}
