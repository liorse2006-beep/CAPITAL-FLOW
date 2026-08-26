import React, { useEffect, useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import DeleteAccountModal from './DeleteAccountModal';
import UserAvatar from './UserAvatar';

function accessLabel(user) {
  if (user && user.tier === 'elite') return 'Elite';
  if (user && user.tier === 'premium') return 'Premium';
  if (user && user.elite_access) return '7-day trial';
  return 'Free';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const date = new Date(numeric ? Number(value) * 1000 : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function Stat({ label, value, detail }) {
  return (
    <div className="profile-stat">
      <span className="profile-modal-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Section({ children, id }) {
  return (
    <section className="account-center-section" id={id}>
      {children}
    </section>
  );
}

const ACCOUNT_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    eyebrow: 'ACCOUNT',
    title: 'Account overview',
    description: 'Your identity, access, and sign-in details at a glance.',
  },
  {
    id: 'plan',
    label: 'Plan & access',
    eyebrow: 'ACCESS',
    title: 'Plan & access',
    description: 'See the level of access currently active on your account.',
  },
  {
    id: 'usage',
    label: 'Workspace usage',
    eyebrow: 'WORKSPACE',
    title: 'Workspace usage',
    description: 'A clear view of scans, alerts, schedules, and saved activity.',
  },
  {
    id: 'security',
    label: 'Security & sign-in',
    eyebrow: 'SECURITY',
    title: 'Security & sign-in',
    description: 'Protect your account, password, and active sessions.',
  },
  {
    id: 'scheduling',
    label: 'Scan scheduling',
    eyebrow: 'WORKSPACE',
    title: 'Scan scheduling',
    description: 'Choose when Capital Flow should run your automated scans.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    eyebrow: 'PREFERENCES',
    title: 'Notifications',
    description: 'Control whether this device can receive Capital Flow alerts.',
  },
  {
    id: 'privacy',
    label: 'Privacy & data',
    eyebrow: 'PRIVACY',
    title: 'Privacy & data',
    description: 'Download your data or permanently close your account.',
  },
];

export default function ProfileModal({
  user,
  getToken,
  initialSection,
  onClose,
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
  onUpgrade,
}) {
  const panelRef = useModalA11y(onClose);
  const firstSection = ACCOUNT_SECTIONS.some((section) => section.id === initialSection) ? initialSection : 'overview';
  const [activeSection, setActiveSection] = useState(firstSection);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState(() => (getToken && user ? 'loading' : 'ready'));
  const [summaryError, setSummaryError] = useState('');
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordState, setPasswordState] = useState({ status: 'idle', message: '' });
  const [downloadState, setDownloadState] = useState('idle');
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionError, setActionError] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const account = summary?.user || user || {};
  const security = summary?.security || {};
  const usage = summary?.usage || {};
  const plan = summary?.plan || {};
  const provider = account.auth_provider || security.authProvider || '—';
  const canChangePassword = provider === 'Email and password';

  useEffect(() => {
    let cancelled = false;
    if (!getToken || !user) return undefined;
    fetch('/api/account/summary', { headers: { Authorization: 'Bearer ' + getToken() } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load profile data');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setSummaryState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setSummaryState('error');
        setSummaryError(error.message || 'Could not load profile data');
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, user]);

  const activeSectionMeta = ACCOUNT_SECTIONS.find((section) => section.id === activeSection) || ACCOUNT_SECTIONS[0];

  function selectSection(sectionId) {
    setActiveSection(sectionId);
    setMobileNavOpen(false);
  }

  function updatePasswordField(field, value) {
    setPassword((previous) => ({ ...previous, [field]: value }));
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (!password.current || !password.next || !password.confirm) {
      setPasswordState({ status: 'error', message: 'Complete all password fields.' });
      return;
    }
    if (password.next.length < 8) {
      setPasswordState({ status: 'error', message: 'The new password must be at least 8 characters.' });
      return;
    }
    if (password.next !== password.confirm) {
      setPasswordState({ status: 'error', message: 'The new passwords do not match.' });
      return;
    }
    setPasswordState({ status: 'saving', message: '' });
    try {
      const response = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ currentPassword: password.current, newPassword: password.next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update password');
      onPasswordChanged?.(data.token, data.user);
      setPassword({ current: '', next: '', confirm: '' });
      setPasswordState({ status: 'success', message: 'Password updated. Other sessions were signed out.' });
      setSummary((previous) =>
        previous ? { ...previous, security: { ...previous.security, activeSessionCount: 1 } } : previous
      );
    } catch (error) {
      setPasswordState({ status: 'error', message: error.message || 'Could not update password' });
    }
  }

  function requestNotificationsChange() {
    setActionError('');
    if (!canNotify) {
      onUpgrade?.();
      return;
    }
    if (!notificationApiSupported || !pushSupported || notificationPermission === 'denied') return;
    setConfirmAction(pushEnabled ? 'disable-notifications' : 'enable-notifications');
  }

  async function confirmSensitiveAction() {
    if (!confirmAction) return;
    setActionError('');
    try {
      if (confirmAction === 'enable-notifications') {
        await onEnablePush?.();
      } else if (confirmAction === 'disable-notifications') {
        await onDisablePush?.();
      } else if (confirmAction === 'logout-all') {
        const response = await fetch('/api/account/logout-all', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + getToken() },
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Could not sign out other sessions');
        }
        onClose();
        window.location.reload();
        return;
      }
      setConfirmAction(null);
    } catch (error) {
      setActionError(error.message || 'The action could not be completed');
    }
  }

  async function downloadData() {
    if (!getToken) return;
    setDownloadState('loading');
    try {
      const response = await fetch('/api/account/export', { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!response.ok) throw new Error('Could not prepare your data export');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'capital-flow-data.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloadState('success');
    } catch (error) {
      setDownloadState('error');
    }
  }

  const notificationBlocked = notificationPermission === 'denied';
  const notificationUnavailable = !notificationApiSupported || !pushSupported;
  let notificationLabel = pushEnabled ? 'Disable notifications' : 'Allow notifications';
  let notificationDescription = pushEnabled
    ? 'Push alerts are active on this device.'
    : 'Receive watchlist and scheduled-scan alerts even when the app is closed.';
  if (!canNotify) {
    notificationLabel = 'Upgrade for notifications';
    notificationDescription = 'Push notifications are included with Elite and the active 7-day trial.';
  } else if (notificationBlocked) {
    notificationLabel = 'Blocked in browser settings';
    notificationDescription = 'Allow notifications for this site in your browser settings, then return here.';
  } else if (notificationUnavailable) {
    notificationLabel = 'Unavailable on this device';
    notificationDescription = 'This browser or device does not expose the required push-notification APIs.';
  }

  const quota = usage.quota || {};
  let scanDetail = '—';
  if (quota.tier === 'elite') scanDetail = 'Unlimited';
  else if (quota.tier === 'premium' && quota.premium) scanDetail = `${quota.premium.left}/${quota.premium.limit} left`;
  else if (quota.free?.trialActive) scanDetail = 'Unlimited in trial';
  else if (quota.free) scanDetail = 'Trial ended';

  return (
    <>
      <div
        className="upgrade-overlay profile-overlay account-center-overlay"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="upgrade-modal profile-modal account-center"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-modal-title"
        >
          <header className="account-center-header">
            <div className="account-center-identity">
              <UserAvatar user={account} className="profile-modal-avatar" />
              <div className="account-center-identity-copy">
                <div className="profile-modal-kicker">CAPITAL FLOW ACCOUNT</div>
                <h2 id="profile-modal-title">Account Center</h2>
                <p>{account.email || '—'}</p>
              </div>
            </div>
            <div className="account-center-header-actions">
              <span className="account-center-tier">{accessLabel(account).toUpperCase()}</span>
              <button className="upgrade-close" onClick={onClose} aria-label="Close profile" type="button">
                ×
              </button>
            </div>
          </header>

          <div className={'account-center-layout' + (mobileNavOpen ? ' account-center-layout--mobile-nav' : '')}>
            <aside className="account-center-sidebar" aria-label="Account sections">
              <div className="account-center-nav-label">ACCOUNT CENTER</div>
              {ACCOUNT_SECTIONS.map((section) => (
                <button
                  className={'account-center-nav-item' + (activeSection === section.id ? ' is-active' : '')}
                  type="button"
                  key={section.id}
                  onClick={() => selectSection(section.id)}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                >
                  <span>{section.label}</span>
                  <span className="account-center-nav-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </aside>

            <nav className="account-center-mobile-nav" aria-label="Account sections">
              <div className="account-center-nav-label">ACCOUNT CENTER</div>
              {ACCOUNT_SECTIONS.map((section) => (
                <button
                  className="account-center-mobile-nav-item"
                  type="button"
                  key={section.id}
                  onClick={() => selectSection(section.id)}
                >
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.description}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </nav>

            <main className="account-center-content">
              <button
                className="account-center-mobile-back"
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Back to account sections"
              >
                ← All account sections
              </button>
              <div className="account-center-content-head">
                <span className="profile-modal-section-eyebrow">{activeSectionMeta.eyebrow}</span>
                <h3>{activeSectionMeta.title}</h3>
                <p>{activeSectionMeta.description}</p>
              </div>

              <div className="account-center-panel">
                {activeSection === 'overview' && (
                  <Section id="profile-section-overview">
                    <div className="profile-stat-grid profile-stat-grid--four">
                      <Stat label="Access" value={accessLabel(account)} detail={plan.access || '—'} />
                      <Stat
                        label="Verification"
                        value={account.is_verified ? 'Verified' : 'Pending'}
                        detail="Email status"
                      />
                      <Stat
                        label="Sign-in"
                        value={provider === 'Email and password' ? 'Email' : provider}
                        detail="Authentication"
                      />
                      <Stat label="Member since" value={formatDate(account.created_at)} />
                    </div>
                  </Section>
                )}

                {activeSection === 'plan' && (
                  <Section id="profile-section-plan">
                    <div className="profile-modal-detail-list">
                      <div className="profile-modal-detail">
                        <span className="profile-modal-label">Current level</span>
                        <strong className="profile-modal-value">{accessLabel(account)}</strong>
                      </div>
                      <div className="profile-modal-detail">
                        <span className="profile-modal-label">Trial status</span>
                        <span className="profile-modal-value">
                          {plan.trialActive
                            ? `Active · ends ${formatDate(plan.trialEndsAt)}`
                            : account.tier === 'free'
                              ? 'Not active'
                              : 'Not applicable'}
                        </span>
                      </div>
                    </div>
                    {onUpgrade && (
                      <button className="profile-primary-btn account-center-plan-cta" type="button" onClick={onUpgrade}>
                        View upgrade options
                      </button>
                    )}
                  </Section>
                )}

                {activeSection === 'usage' && (
                  <Section id="profile-section-usage">
                    {summaryState === 'loading' ? (
                      <div className="profile-modal-loading">Loading current usage…</div>
                    ) : summaryState === 'error' ? (
                      <div className="profile-modal-inline-error">{summaryError}</div>
                    ) : (
                      <div className="profile-stat-grid profile-stat-grid--four">
                        <Stat label="Scans" value={scanDetail} detail="Current access" />
                        <Stat label="Watchlist" value={number(usage.watchlistCount)} detail="Saved tickers" />
                        <Stat label="Alerts" value={number(usage.alertCount)} detail="Active thresholds" />
                        <Stat
                          label="Radar"
                          value={number(usage.activeRadarCount)}
                          detail={`${number(usage.radarCount)} total rules`}
                        />
                        <Stat
                          label="Schedules"
                          value={number(usage.activeScheduleCount)}
                          detail={`${number(usage.scheduleCount)} total`}
                        />
                        <Stat label="Devices" value={number(usage.pushDeviceCount)} detail="Push subscriptions" />
                        <Stat
                          label="Capi messages"
                          value={number(usage.chatMessageCount)}
                          detail="Saved conversations"
                        />
                        <Stat label="Sessions" value={number(security.activeSessionCount)} detail="Signed-in devices" />
                      </div>
                    )}
                  </Section>
                )}

                {activeSection === 'security' && (
                  <Section id="profile-section-security">
                    <div className="profile-modal-detail-list">
                      <div className="profile-modal-detail">
                        <span className="profile-modal-label">Last sign-in</span>
                        <span className="profile-modal-value">{formatDateTime(account.last_login_at)}</span>
                      </div>
                      <div className="profile-modal-detail">
                        <span className="profile-modal-label">Active sessions</span>
                        <span className="profile-modal-value">{number(security.activeSessionCount || 0)}</span>
                      </div>
                    </div>

                    {canChangePassword ? (
                      <form className="profile-password-form" onSubmit={submitPassword}>
                        <div className="profile-form-heading">Change password</div>
                        <input
                          className="auth-input profile-password-input"
                          type="password"
                          placeholder="Current password"
                          autoComplete="current-password"
                          value={password.current}
                          onChange={(event) => updatePasswordField('current', event.target.value)}
                          aria-label="Current password"
                        />
                        <input
                          className="auth-input profile-password-input"
                          type="password"
                          placeholder="New password · 8 characters minimum"
                          autoComplete="new-password"
                          value={password.next}
                          onChange={(event) => updatePasswordField('next', event.target.value)}
                          aria-label="New password"
                        />
                        <input
                          className="auth-input profile-password-input"
                          type="password"
                          placeholder="Confirm new password"
                          autoComplete="new-password"
                          value={password.confirm}
                          onChange={(event) => updatePasswordField('confirm', event.target.value)}
                          aria-label="Confirm new password"
                        />
                        {passwordState.message && (
                          <p
                            className={
                              'profile-modal-form-message ' + (passwordState.status === 'success' ? 'success' : 'error')
                            }
                          >
                            {passwordState.message}
                          </p>
                        )}
                        <button
                          className="profile-secondary-btn"
                          type="submit"
                          disabled={passwordState.status === 'saving'}
                        >
                          {passwordState.status === 'saving' ? 'Updating…' : 'Update password'}
                        </button>
                      </form>
                    ) : (
                      <div className="profile-modal-info-box">
                        <strong>Password managed by Google</strong>
                        <span>Change it from your Google Account security settings.</span>
                      </div>
                    )}

                    <button
                      className="profile-danger-link"
                      type="button"
                      onClick={() => setConfirmAction('logout-all')}
                    >
                      Sign out all devices
                    </button>
                  </Section>
                )}

                {activeSection === 'scheduling' && (
                  <Section id="profile-section-scheduling">
                    <div className="account-center-action-card">
                      <div>
                        <strong>Automated scan timing</strong>
                        <span>Choose when Capital Flow should run a scan and notify you with the result.</span>
                      </div>
                      <button className="profile-primary-btn" type="button" onClick={onOpenScheduling}>
                        Schedule scans
                      </button>
                    </div>
                  </Section>
                )}

                {activeSection === 'notifications' && (
                  <Section id="profile-section-notifications">
                    <div className="account-center-action-card">
                      <div>
                        <strong>Notification access</strong>
                        <span>{notificationDescription}</span>
                        {pushError && <small className="profile-modal-form-message error">{pushError}</small>}
                      </div>
                      <button
                        className={'profile-primary-btn' + (pushEnabled ? ' profile-secondary-btn--active' : '')}
                        type="button"
                        onClick={requestNotificationsChange}
                        disabled={pushBusy || (canNotify && (notificationBlocked || notificationUnavailable))}
                      >
                        {pushBusy ? 'Working…' : notificationLabel}
                      </button>
                    </div>
                  </Section>
                )}

                {activeSection === 'privacy' && (
                  <Section id="profile-section-privacy">
                    <div className="profile-privacy-actions">
                      <button
                        className="profile-secondary-btn"
                        type="button"
                        onClick={downloadData}
                        disabled={downloadState === 'loading'}
                      >
                        {downloadState === 'loading' ? 'Preparing…' : 'Download my data'}
                      </button>
                      <button className="profile-danger-btn" type="button" onClick={() => setShowDelete(true)}>
                        Delete account
                      </button>
                    </div>
                    {downloadState === 'success' && (
                      <p className="profile-modal-form-message success">Your data download has started.</p>
                    )}
                    {downloadState === 'error' && (
                      <p className="profile-modal-form-message error">Could not prepare the download. Try again.</p>
                    )}
                  </Section>
                )}
              </div>
            </main>
          </div>

          <footer className="account-center-footer">
            <span>Account changes apply to this workspace.</span>
            <button className="profile-secondary-btn" onClick={onClose} type="button">
              Done
            </button>
          </footer>

          {confirmAction && (
            <div className="profile-confirm-layer" role="presentation">
              <div
                className="profile-confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="profile-confirm-title"
              >
                <span className="profile-modal-section-eyebrow">CONFIRM ACTION</span>
                <h3 id="profile-confirm-title">
                  {confirmAction === 'enable-notifications'
                    ? 'Allow notifications on this device?'
                    : confirmAction === 'disable-notifications'
                      ? 'Disable notifications on this device?'
                      : 'Sign out all devices?'}
                </h3>
                <p>
                  {confirmAction === 'enable-notifications'
                    ? 'Capital Flow will be allowed to send push alerts and scheduled-scan results to this browser or device.'
                    : confirmAction === 'disable-notifications'
                      ? 'This device will stop receiving push notifications. Your account alerts and schedules will remain saved.'
                      : 'This includes the current browser. You will need to sign in again on every device.'}
                </p>
                {actionError && <div className="profile-modal-form-message error">{actionError}</div>}
                <div className="profile-confirm-actions">
                  <button className="profile-secondary-btn" type="button" onClick={() => setConfirmAction(null)}>
                    Cancel
                  </button>
                  <button className="profile-primary-btn" type="button" onClick={confirmSensitiveAction}>
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showDelete && (
        <DeleteAccountModal
          getToken={getToken}
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false);
            onClose();
            onAccountDeleted?.();
          }}
        />
      )}
    </>
  );
}
