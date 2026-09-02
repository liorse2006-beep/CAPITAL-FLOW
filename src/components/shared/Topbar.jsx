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

function ProfileMenuArrow({ external = false }) {
  return (
    <svg
      className={'topbar-profile-menu-arrow' + (external ? ' topbar-profile-menu-arrow--external' : '')}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {external ? <path d="M5 11 11 5M7 5h4v4" /> : <path d="m6 3 4 5-4 5" />}
    </svg>
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
  const [profileModalSection, setProfileModalSection] = useState('account');
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

  function openProfile(section = 'account') {
    setProfileMenuOpen(false);
    setProfileModalSection(section);
    setProfileModalOpen(true);
  }

  const profileMenuSections = [
    {
      label: 'ACCOUNT',
      items: [{ label: 'Account & workspace', hint: 'Identity, plan, and usage', section: 'account' }],
    },
    {
      label: 'AUTOMATION',
      items: [{ label: 'Automation & alerts', hint: 'Scheduled scans and notifications', section: 'automation' }],
    },
    {
      label: 'SECURITY',
      items: [{ label: 'Security & privacy', hint: 'Password, sessions, and data', section: 'security' }],
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
                onClick={() => {
                  if (!profileMenuOpen && showAlertPanel) onClosePanel?.();
                  setProfileMenuOpen((open) => !open);
                }}
                aria-label="Open profile menu"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-controls="profile-menu"
                title="Open profile"
              >
                <UserAvatar user={user} className="topbar-profile-avatar" />
              </button>
              {profileMenuOpen && (
                <div id="profile-menu" className="topbar-profile-menu" role="menu" aria-label="Profile menu">
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
                            onClick={() => openProfile(item.section)}
                          >
                            <span className="topbar-profile-menu-item-copy">
                              <strong>{item.label}</strong>
                              <small>{item.hint}</small>
                            </span>
                            <ProfileMenuArrow />
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
                    <ProfileMenuArrow external />
                  </button>
                </div>
              )}
            </div>
          )}
          <AlertBell
            notificationsEnabled={notificationsEnabled}
            showAlertPanel={showAlertPanel}
            onBellClick={() => {
              if (!showAlertPanel) setProfileMenuOpen(false);
              onBellClick();
            }}
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
