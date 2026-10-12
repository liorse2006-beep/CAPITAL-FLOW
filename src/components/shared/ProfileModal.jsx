import React, { useCallback, useEffect, useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import useAccountOperation from '../../hooks/useAccountOperation';
import DeleteAccountModal from './DeleteAccountModal';
import UserAvatar from './UserAvatar';
import { friendlyError } from '../../utils/format';

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
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return 'Not yet run';
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const date = new Date(numeric ? Number(value) * 1000 : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

const SCHEDULE_SCAN_LABELS = {
  capitalFlow: 'Capital Flow',
  maScanner: 'MA Scanner',
  sectorMoving: 'Hot Sectors',
};

function formatScheduleDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function scheduleTiming(schedule) {
  const time = schedule.scan_time || '—';
  if (schedule.scan_date) return `${formatScheduleDate(schedule.scan_date)} · ${time}`;
  return `${time} · Every day`;
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

function SubsectionHeader({ eyebrow, title }) {
  return (
    <div className="account-center-subsection-head">
      <span className="account-center-subsection-eyebrow">{eyebrow}</span>
      <h4>{title}</h4>
    </div>
  );
}

const ACCOUNT_SECTIONS = [
  {
    id: 'account',
    label: 'Account and activity',
    eyebrow: 'ACCOUNT',
    title: 'Account and activity',
    description: 'Your account details, plan and activity.',
  },
  {
    id: 'automation',
    label: 'Schedules and alerts',
    eyebrow: 'Schedules',
    title: 'Schedules and alerts',
    description: 'Manage scheduled scans and device notifications.',
  },
  {
    id: 'security',
    label: 'Security and privacy',
    eyebrow: 'Security',
    title: 'Security and privacy',
    description: 'Protect your account and manage your data.',
  },
];

const LEGACY_SECTION_GROUP = {
  overview: 'account',
  plan: 'account',
  usage: 'account',
  scheduling: 'automation',
  notifications: 'automation',
  privacy: 'security',
};

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
  const beginOperation = useAccountOperation(getToken, user?.id);
  const requestedSection = LEGACY_SECTION_GROUP[initialSection] || initialSection;
  const firstSection = ACCOUNT_SECTIONS.some((section) => section.id === requestedSection)
    ? requestedSection
    : 'account';
  const [activeSection, setActiveSection] = useState(firstSection);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState(() => (getToken && user ? 'loading' : 'ready'));
  const [summaryError, setSummaryError] = useState('');
  const [scheduledScans, setScheduledScans] = useState([]);
  const [scheduledScansState, setScheduledScansState] = useState('idle');
  const [scheduledScansError, setScheduledScansError] = useState('');
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
    const operation = beginOperation('summary');
    if (!operation) return undefined;
    fetch('/api/account/summary', {
      headers: { Authorization: 'Bearer ' + operation.token },
      signal: operation.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('Could not load profile data');
        return data;
      })
      .then((data) => {
        if (cancelled || !operation.canCommit()) return;
        setSummary(data);
        setSummaryState('ready');
      })
      .catch(() => {
        if (cancelled || !operation.isCurrent()) return;
        setSummaryState('error');
        setSummaryError('Could not load profile data. Try again.');
      })
      .finally(operation.finish);
    return () => {
      cancelled = true;
      operation.cancel();
    };
  }, [getToken, user, beginOperation]);

  const loadScheduledScans = useCallback(async () => {
    if (!getToken || !user) return;
    const operation = beginOperation('schedules');
    if (!operation) return;
    setScheduledScansState('loading');
    setScheduledScansError('');
    try {
      const response = await fetch('/api/scheduled-scans', {
        headers: { Authorization: 'Bearer ' + operation.token },
        signal: operation.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!operation.canCommit()) return;
      if (!response.ok) throw new Error('Could not load scheduled scans');
      setScheduledScans(Array.isArray(data.schedules) ? data.schedules : []);
      setScheduledScansState('ready');
    } catch {
      if (!operation.isCurrent()) return;
      setScheduledScansState('error');
      setScheduledScansError("We couldn't load your scheduled scans. Please try again.");
    } finally {
      operation.finish();
    }
  }, [getToken, user, beginOperation]);

  useEffect(() => {
    if (activeSection !== 'automation') return undefined;
    // Loading a newly selected account section is an intentional external
    // data synchronization; the callback owns the loading/result states.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadScheduledScans();
    return undefined;
  }, [activeSection, loadScheduledScans]);

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
    if ([...password.next].length < 15) {
      setPasswordState({ status: 'error', message: 'Your new password must have at least 15 characters.' });
      return;
    }
    if (password.next !== password.confirm) {
      setPasswordState({ status: 'error', message: 'Your new passwords do not match.' });
      return;
    }
    const operation = beginOperation('password');
    if (!operation) return;
    setPasswordState({ status: 'saving', message: '' });
    try {
      const response = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + operation.token },
        signal: operation.signal,
        body: JSON.stringify({ currentPassword: password.current, newPassword: password.next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!operation.canCommit()) return;
      if (!response.ok) throw new Error('Could not update password');
      if (typeof data.token !== 'string' || !data.token || String(data.user?.id) !== String(user?.id)) {
        throw new Error('Could not confirm password update');
      }
      onPasswordChanged?.(data.token, data.user);
      setPassword({ current: '', next: '', confirm: '' });
      setPasswordState({ status: 'success', message: 'Password updated. Other sessions were signed out.' });
      setSummary((previous) =>
        previous ? { ...previous, security: { ...previous.security, activeSessionCount: 1 } } : previous
      );
    } catch {
      if (!operation.isCurrent()) return;
      setPasswordState({
        status: 'error',
        message: "We couldn't confirm the password update. Sign in again to check.",
      });
    } finally {
      operation.finish();
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
    const operation = beginOperation('confirm-action');
    if (!operation) return;
    setActionError('');
    try {
      if (confirmAction === 'enable-notifications') {
        await onEnablePush?.();
      } else if (confirmAction === 'disable-notifications') {
        await onDisablePush?.();
      } else if (confirmAction === 'logout-all') {
        const response = await fetch('/api/account/logout-all', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + operation.token },
          signal: operation.signal,
        });
        if (!operation.canCommit()) return;
        if (!response.ok) {
          throw new Error('Could not sign out other sessions');
        }
        onClose();
        window.location.reload();
        return;
      }
      if (operation.canCommit()) setConfirmAction(null);
    } catch {
      if (operation.isCurrent()) setActionError("We couldn't confirm the change. Check your settings and try again.");
    } finally {
      operation.finish();
    }
  }

  async function downloadData() {
    if (!getToken) return;
    const operation = beginOperation('export');
    if (!operation) return;
    setDownloadState('loading');
    try {
      const response = await fetch('/api/account/export', {
        headers: { Authorization: 'Bearer ' + operation.token },
        signal: operation.signal,
      });
      if (!response.ok) throw new Error('Could not prepare your data export');
      const blob = await response.blob();
      if (!operation.canCommit()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'capital-flow-data.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloadState('success');
    } catch {
      if (operation.isCurrent()) setDownloadState('error');
    } finally {
      operation.finish();
    }
  }

  const notificationBlocked = notificationPermission === 'denied';
  const notificationUnavailable = !notificationApiSupported || !pushSupported;
  let notificationLabel = pushEnabled ? 'Disable notifications' : 'Enable notifications';
  let notificationDescription = pushEnabled
    ? 'Notifications are enabled on this device.'
    : 'Receive watchlist alerts and scheduled scan results even when the app is closed.';
  if (!canNotify) {
    notificationLabel = 'Upgrade to enable notifications';
    notificationDescription = 'Device notifications are included with Elite and during your active trial.';
  } else if (notificationBlocked) {
    notificationLabel = 'Blocked in browser settings';
    notificationDescription = 'Allow notifications for this site in your browser settings, then return here.';
  } else if (notificationUnavailable) {
    notificationLabel = 'Unavailable on this device';
    notificationDescription =
      'On iPhone: Share → Add to Home Screen. Open the app there and enable notifications. In other browsers, check notification support.';
  }

  const quota = usage.quota || {};
  let scanDetail = '—';
  if (quota.tier === 'elite') scanDetail = 'Unlimited';
  else if (quota.tier === 'premium' && quota.premium) scanDetail = `${quota.premium.left}/${quota.premium.limit} left`;
  else if (quota.free?.trialActive) scanDetail = 'Unlimited during your trial';
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
                <h2 id="profile-modal-title">Account center</h2>
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
              <div className="account-center-nav-label">Account center</div>
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
              <div className="account-center-nav-label">Account center</div>
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
                {activeSection === 'account' && (
                  <div className="account-center-group">
                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Account overview" title="Account overview" />
                      <Section id="profile-section-overview">
                        <div className="profile-stat-grid profile-stat-grid--four">
                          <Stat
                            label="Access"
                            value={accessLabel(account)}
                            detail={
                              plan.access === 'Full access'
                                ? 'Full access'
                                : plan.access === 'Limited access'
                                  ? 'Limited access'
                                  : '—'
                            }
                          />
                          <Stat
                            label="Verification"
                            value={account.is_verified ? 'Verified' : 'Pending verification'}
                            detail="Email verification status"
                          />
                          <Stat
                            label="Log In"
                            value={
                              provider === 'Email and password'
                                ? 'Email and password'
                                : provider === 'Google'
                                  ? 'Google'
                                  : 'Unavailable'
                            }
                            detail="Sign-in method"
                          />
                          <Stat label="Joined" value={formatDate(account.created_at)} />
                        </div>
                      </Section>
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Access" title="Plan & access" />
                      <Section id="profile-section-plan">
                        <div className="profile-modal-detail-list">
                          <div className="profile-modal-detail">
                            <span className="profile-modal-label">Current plan</span>
                            <strong className="profile-modal-value">{accessLabel(account)}</strong>
                          </div>
                          <div className="profile-modal-detail">
                            <span className="profile-modal-label">Trial status</span>
                            <span className="profile-modal-value">
                              {plan.trialActive
                                ? `Active · ends ${formatDate(plan.trialEndsAt)}`
                                : account.tier === 'free'
                                  ? 'Inactive'
                                  : 'Not applicable'}
                            </span>
                          </div>
                        </div>
                        {onUpgrade && (
                          <button
                            className="profile-primary-btn account-center-plan-cta"
                            type="button"
                            onClick={onUpgrade}
                          >
                            View upgrade options
                          </button>
                        )}
                      </Section>
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Activity" title="Workspace usage" />
                      <Section id="profile-section-usage">
                        {summaryState === 'loading' ? (
                          <div className="profile-modal-loading">Loading current usage…</div>
                        ) : summaryState === 'error' ? (
                          <div className="profile-modal-inline-error">{summaryError}</div>
                        ) : (
                          <div className="profile-stat-grid profile-stat-grid--four">
                            <Stat label="Scans" value={scanDetail} detail="Current allowance" />
                            <Stat label="Watchlist" value={number(usage.watchlistCount)} detail="Saved stocks" />
                            <Stat label="Notifications" value={number(usage.alertCount)} detail="Active conditions" />
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
                            <Stat
                              label="Devices"
                              value={number(usage.pushDeviceCount)}
                              detail="Devices with notifications"
                            />
                            <Stat
                              label="Sessions"
                              value={number(security.activeSessionCount)}
                              detail="Signed-in devices"
                            />
                          </div>
                        )}
                      </Section>
                    </div>
                  </div>
                )}

                {activeSection === 'automation' && (
                  <div className="account-center-group">
                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Preferences" title="Notifications" />
                      <Section id="profile-section-notifications">
                        <div className="account-center-action-card">
                          <div>
                            <strong>Notification access</strong>
                            <span>{notificationDescription}</span>
                            {pushError && (
                              <small className="profile-modal-form-message error">{friendlyError(pushError)}</small>
                            )}
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
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Activity" title="Schedule scans" />
                      <Section id="profile-section-scheduling">
                        {scheduledScansState === 'loading' && (
                          <div className="account-center-schedule-state" role="status">
                            Loading your scheduled scans…
                          </div>
                        )}

                        {scheduledScansState === 'error' && (
                          <div className="account-center-schedule-state account-center-schedule-state--error">
                            <strong>Scheduled scans are currently unavailable.</strong>
                            <span>{scheduledScansError}</span>
                            <button className="profile-secondary-btn" type="button" onClick={loadScheduledScans}>
                              Try again
                            </button>
                          </div>
                        )}

                        {scheduledScansState === 'ready' && scheduledScans.length === 0 && (
                          <div className="account-center-schedule-empty">
                            <div className="account-center-schedule-empty-icon" aria-hidden="true">
                              ◷
                            </div>
                            <strong>No scheduled scans yet.</strong>
                            <span>Choose a time and we&#39;ll run your scan automatically.</span>
                            <button className="profile-primary-btn" type="button" onClick={onOpenScheduling}>
                              Schedule scans
                            </button>
                          </div>
                        )}

                        {scheduledScansState === 'ready' && scheduledScans.length > 0 && (
                          <>
                            <div className="account-center-schedule-list" aria-label="Your scheduled scans">
                              {scheduledScans.map((schedule) => {
                                const active = Boolean(schedule.active);
                                return (
                                  <article className="account-center-schedule-item" key={schedule.id}>
                                    <div className="account-center-schedule-item-copy">
                                      <div className="account-center-schedule-item-heading">
                                        <strong>{SCHEDULE_SCAN_LABELS[schedule.scan_type] || 'Scheduled scan'}</strong>
                                        <span
                                          className={'account-center-schedule-status' + (active ? ' is-active' : '')}
                                        >
                                          {active ? 'Active' : 'Paused'}
                                        </span>
                                      </div>
                                      <span className="account-center-schedule-item-time">
                                        {scheduleTiming(schedule)}
                                      </span>
                                      <small>
                                        {schedule.scan_date ? 'One-time scan' : 'Repeats daily'} · Jerusalem time
                                        {schedule.last_run_at
                                          ? ` · Last run ${formatDateTime(schedule.last_run_at)}`
                                          : ' · Not yet run'}
                                      </small>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                            <button
                              className="profile-primary-btn account-center-schedule-cta"
                              type="button"
                              onClick={onOpenScheduling}
                            >
                              Schedule another scan
                            </button>
                          </>
                        )}
                      </Section>
                    </div>
                  </div>
                )}

                {activeSection === 'security' && (
                  <div className="account-center-group">
                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Security" title="Security & sign-in" />
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
                              placeholder="New password · at least 15 characters"
                              minLength={15}
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
                                  'profile-modal-form-message ' +
                                  (passwordState.status === 'success' ? 'success' : 'error')
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
                            <strong>Your password is managed by Google</strong>
                            <span>You can change it in your Google account&#39;s security settings.</span>
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
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="Privacy" title="Privacy & data" />
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
                    </div>
                  </div>
                )}
              </div>
            </main>
          </div>

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
                    ? 'Capital Flow will be able to send alerts and scan results to this device.'
                    : confirmAction === 'disable-notifications'
                      ? "This device will stop receiving notifications. Your account's alerts and schedules will remain saved."
                      : "This browser will also be signed out. You'll need to sign in again on every device."}
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
