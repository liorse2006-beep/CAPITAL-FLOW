import React from 'react'
import AlertBell from './AlertBell'

function TierBadgeOrUpgrade({ isElite, isPremium, user, onUpgrade, onSignIn }) {
  if (isElite) {
    return <span className="topbar-premium-badge tier-elite">ELITE EDITION</span>
  }
  if (isPremium) {
    return (
      <>
        <span className="topbar-premium-badge tier-premium">PREMIUM</span>
        <button className="topbar-upgrade-btn" onClick={onUpgrade}>
          Upgrade to Elite
        </button>
      </>
    )
  }
  const rocket = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
  if (user) {
    return (
      <button className="topbar-upgrade-btn" onClick={onUpgrade}>
        {rocket}
        Upgrade Subscription
      </button>
    )
  }
  return (
    <>
      <button className="topbar-upgrade-btn" onClick={onSignIn}>
        {rocket}
        Upgrade Subscription
      </button>
      <button className="topbar-signin-btn" onClick={onSignIn}>
        Sign In
      </button>
    </>
  )
}

export default function Topbar({
  user,
  isElite,
  isPremium,
  getToken,
  logout,
  page,
  results,
  scanning,
  scanMeta,
  onNewScan,
  onUpgrade,
  onSignIn,
  notificationsEnabled,
  showAlertPanel,
  onBellClick,
  unreadCount,
  alertHistory,
  onClearAll,
  onClosePanel,
  onRemoveAlert,
  onToggleNotifications,
  setPage,
  watchlistCount,
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo-mark">
            <div className="logo-bar" />
            <div className="logo-bar" />
            <div className="logo-bar" />
          </div>
          <div className="logo-text">
            <h1>
              <strong>Capital</strong> Flow
            </h1>
          </div>
        </div>
        <div className="topbar-right">
          <TierBadgeOrUpgrade
            isElite={isElite}
            isPremium={isPremium}
            user={user}
            onUpgrade={onUpgrade}
            onSignIn={onSignIn}
          />
          {user && user.is_admin && (
            <button
              className="topbar-admin-btn"
              onClick={() => window.open('/admin?jwt=' + getToken(), '_blank')}
              title="Admin Panel"
            >
              Admin
            </button>
          )}
          {user && (
            <button className="topbar-logout-btn" onClick={logout} title="Sign out">
              Log Out
            </button>
          )}
          <AlertBell
            notificationsEnabled={notificationsEnabled}
            showAlertPanel={showAlertPanel}
            onBellClick={onBellClick}
            unreadCount={unreadCount}
            alertHistory={alertHistory}
            onClearAll={onClearAll}
            onClosePanel={onClosePanel}
            onRemoveAlert={onRemoveAlert}
            onToggleNotifications={onToggleNotifications}
          />
          {page === 'scanner' && results && !scanning && (
            <>
              <button className="scan-btn" onClick={onNewScan}>
                New Scan
              </button>
              {!isPremium && scanMeta && scanMeta.tier === 'premium' && (
                <span className="scan-limit-topbar">{(scanMeta.premium ? scanMeta.premium.used : 0) + '/5 today'}</span>
              )}
            </>
          )}
        </div>
      </header>

      <nav className="nav-tabs">
        <button className={'nav-tab ' + (page === 'scanner' ? 'active' : '')} onClick={() => setPage('scanner')}>
          Capital Flow
        </button>
        <button className={'nav-tab ' + (page === 'flow' ? 'active' : '')} onClick={() => setPage('flow')}>
          Sector Moving
        </button>
        <button className={'nav-tab ' + (page === 'ma' ? 'active' : '')} onClick={() => setPage('ma')}>
          MA Scanner
        </button>
        <button className={'nav-tab ' + (page === 'watchlist' ? 'active' : '')} onClick={() => setPage('watchlist')}>
          Watchlist
          {watchlistCount > 0 && <span className="tab-badge">{watchlistCount}</span>}
        </button>
      </nav>
    </>
  )
}
