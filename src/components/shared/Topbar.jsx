import React, { useEffect, useRef, useState } from 'react';
import AlertBell from './AlertBell';
import ProfileModal from './ProfileModal';
import UserAvatar from './UserAvatar';

function TierBadgeOrUpgrade({ isElite, isPremium, isTrial, user, onUpgrade, onSignIn }) {
  if (isElite) {
    return <span className="topbar-premium-badge tier-elite">ELITE EDITION</span>;
  }
  if (isPremium) {
    return (
      <>
        <button className="topbar-premium-badge tier-premium" onClick={onUpgrade} aria-label="Open upgrade plans">
          PREMIUM
        </button>
        <button className="topbar-upgrade-btn" onClick={onUpgrade}>
          Upgrade to Elite
        </button>
      </>
    );
  }
  if (isTrial) {
    return (
      <button className="topbar-premium-badge tier-trial" onClick={onUpgrade} aria-label="Open upgrade plans">
        FREE TRIAL
      </button>
    );
  }
  const rocket = (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
  if (user) {
    return (
      <button className="topbar-upgrade-btn" onClick={onUpgrade}>
        {rocket}
        Upgrade Subscription
      </button>
    );
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
  );
}

export default function Topbar({
  user,
  isElite,
  isPremium,
  isTrial,
  logout,
  page,
  results,
  scanning,
  scanMeta,
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
  onOpenNotification,
  onToggleNotifications,
  getToken,
  onPasswordChanged,
  onAccountDeleted,
  onOpenScheduling,
  canNotify,
  pushSupported,
  notificationApiSupported,
  notificationPermission,
  pushEnabled,
  pushBusy,
  pushError,
  onEnablePush,
  onDisablePush,
  setPage,
}) {
  const isAdmin = !!(user && user.is_admin);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalSection, setProfileModalSection] = useState('overview');
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) setProfileMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen]);

  function openProfile(section = 'overview') {
    setProfileMenuOpen(false);
    setProfileModalSection(section);
    setProfileModalOpen(true);
  }

  function openSchedulingFromMenu() {
    setProfileMenuOpen(false);
    setProfileModalOpen(false);
    setProfileModalSection(null);
    onOpenScheduling?.();
  }

  const profileMenuSections = [
    {
      label: 'ACCOUNT',
      items: [
        { label: 'Profile', hint: 'Account overview', section: 'overview' },
        { label: 'Plan & access', hint: 'Tier and trial', section: 'plan' },
        { label: 'Workspace usage', hint: 'Scans and alerts', section: 'usage' },
      ],
    },
    {
      label: 'SECURITY',
      items: [{ label: 'Security', hint: 'Password and sessions', section: 'security' }],
    },
    {
      label: 'PREFERENCES',
      items: [
        { label: 'Schedule scans', hint: 'Choose scan times', action: 'schedule' },
        { label: 'Notifications', hint: 'Push access', section: 'preferences' },
      ],
    },
    {
      label: 'PRIVACY',
      items: [{ label: 'Privacy & data', hint: 'Export or delete', section: 'privacy' }],
    },
  ];

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
            isTrial={isTrial}
            user={user}
            onUpgrade={onUpgrade}
            onSignIn={onSignIn}
          />
          {isAdmin && (
            <>
              <a
                className="topbar-admin-btn"
                href="/admin"
                target="_blank"
                rel="noopener noreferrer"
                title="Admin panel"
              >
                Admin
              </a>
              <a
                className="topbar-status-btn"
                href="https://status.capitalflow.vip/status"
                target="_blank"
                rel="noopener noreferrer"
                title="System status"
              >
                Status
              </a>
            </>
          )}
          {user && (
            <div className="topbar-profile-wrap" ref={profileMenuRef}>
              <button
                className="topbar-profile-trigger"
                type="button"
                onClick={() => setProfileMenuOpen((open) => !open)}
                aria-label="Open profile menu"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                title="Open profile"
              >
                <UserAvatar user={user} className="topbar-profile-avatar" />
              </button>
              {profileMenuOpen && (
                <div className="topbar-profile-menu" role="menu" aria-label="Profile menu">
                  <div className="topbar-profile-menu-head">
                    <div className="topbar-profile-menu-email" title={user.email}>
                      {user.email}
                    </div>
                    <span className="topbar-profile-menu-tier">
                      {isElite ? 'ELITE' : isPremium ? 'PREMIUM' : isTrial ? 'FREE TRIAL' : 'FREE'}
                    </span>
                  </div>
                  <div className="topbar-profile-menu-links">
                    {profileMenuSections.map((group) => (
                      <div className="topbar-profile-menu-group" key={group.label}>
                        <div className="topbar-profile-menu-group-label">{group.label}</div>
                        {group.items.map((item) => (
                          <button
                            className="topbar-profile-menu-item"
                            type="button"
                            role="menuitem"
                            key={item.label}
                            aria-label={item.label}
                            onClick={() =>
                              item.action === 'schedule' ? openSchedulingFromMenu() : openProfile(item.section)
                            }
                          >
                            <span className="topbar-profile-menu-item-copy">
                              <strong>{item.label}</strong>
                              <small>{item.hint}</small>
                            </span>
                            <span className="topbar-profile-menu-arrow" aria-hidden="true">
                              →
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="topbar-profile-menu-divider" />
                  <button
                    className="topbar-profile-menu-item topbar-profile-menu-item--danger"
                    type="button"
                    role="menuitem"
                    aria-label="Log Out"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      logout();
                    }}
                  >
                    <span className="topbar-profile-menu-item-copy">
                      <strong>Log Out</strong>
                    </span>
                    <span className="topbar-profile-menu-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                </div>
              )}
            </div>
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
            onOpenNotification={onOpenNotification}
            onToggleNotifications={onToggleNotifications}
          />
          {page === 'scanner' && results && !scanning && !isPremium && scanMeta && scanMeta.tier === 'premium' && (
            <span className="scan-limit-topbar">{(scanMeta.premium ? scanMeta.premium.used : 0) + '/5 today'}</span>
          )}
        </div>
      </header>

      {profileModalOpen && (
        <ProfileModal
          user={user}
          getToken={getToken}
          initialSection={profileModalSection}
          onClose={() => {
            setProfileModalOpen(false);
            setProfileModalSection(null);
          }}
          onPasswordChanged={onPasswordChanged}
          onAccountDeleted={onAccountDeleted}
          onOpenScheduling={() => {
            setProfileModalOpen(false);
            setProfileModalSection(null);
            onOpenScheduling?.();
          }}
          canNotify={canNotify}
          pushSupported={pushSupported}
          notificationApiSupported={notificationApiSupported}
          notificationPermission={notificationPermission}
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          pushError={pushError}
          onEnablePush={onEnablePush}
          onDisablePush={onDisablePush}
          onUpgrade={onUpgrade}
        />
      )}

      <nav className="nav-tabs">
        <button className={'nav-tab ' + (page === 'scanner' ? 'active' : '')} onClick={() => setPage('scanner')}>
          Capital Flow
        </button>
        <button className={'nav-tab ' + (page === 'flow' ? 'active' : '')} onClick={() => setPage('flow')}>
          Hot Sectors
        </button>
        <button className={'nav-tab ' + (page === 'ma' ? 'active' : '')} onClick={() => setPage('ma')}>
          MA Scanner
        </button>
        <button
          className={'nav-tab ' + (page === 'fundamentals' ? 'active' : '')}
          onClick={() => setPage('fundamentals')}
        >
          Fundamentals
        </button>
        <button className={'nav-tab ' + (page === 'watchlist' ? 'active' : '')} onClick={() => setPage('watchlist')}>
          Watchlist
        </button>
      </nav>
    </>
  );
}
