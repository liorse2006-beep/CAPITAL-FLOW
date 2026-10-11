import React, { useCallback, useEffect, useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import useAccountOperation from '../../hooks/useAccountOperation';
import DeleteAccountModal from './DeleteAccountModal';
import UserAvatar from './UserAvatar';
import { friendlyError } from '../../utils/format';

function accessLabel(user) {
  if (user && user.tier === 'elite') return 'Elite';
  if (user && user.tier === 'premium') return 'Premium';
  if (user && user.elite_access) return 'ניסיון של שבעה ימים';
  return 'חינמי';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return 'טרם בוצע';
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const date = new Date(numeric ? Number(value) * 1000 : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

const SCHEDULE_SCAN_LABELS = {
  capitalFlow: 'Capital Flow',
  maScanner: 'סורק ממוצעים נעים',
  sectorMoving: 'פעילות בסקטורים',
};

function formatScheduleDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('he-IL', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function scheduleTiming(schedule) {
  const time = schedule.scan_time || '—';
  if (schedule.scan_date) return `${formatScheduleDate(schedule.scan_date)} · ${time}`;
  return `${time} · כל יום`;
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
    label: 'חשבון ופעילות',
    eyebrow: 'חשבון',
    title: 'חשבון ופעילות',
    description: 'פרטי החשבון, המסלול והפעילות שלך.',
  },
  {
    id: 'automation',
    label: 'תזמונים והתראות',
    eyebrow: 'תזמונים',
    title: 'תזמונים והתראות',
    description: 'ניהול סריקות מתוזמנות והתראות למכשירים שלך.',
  },
  {
    id: 'security',
    label: 'אבטחה ופרטיות',
    eyebrow: 'אבטחה',
    title: 'אבטחה ופרטיות',
    description: 'הגנה על החשבון וניהול הנתונים שלך.',
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
        setSummaryError('לא הצלחנו לטעון את פרטי החשבון. אפשר לנסות שוב.');
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
      setScheduledScansError('לא הצלחנו לטעון את הסריקות המתוזמנות. אפשר לנסות שוב.');
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
      setPasswordState({ status: 'error', message: 'יש למלא את כל שדות הסיסמה.' });
      return;
    }
    if ([...password.next].length < 15) {
      setPasswordState({ status: 'error', message: 'הסיסמה החדשה צריכה להיות באורך 15 תווים לפחות.' });
      return;
    }
    if (password.next !== password.confirm) {
      setPasswordState({ status: 'error', message: 'הסיסמאות החדשות אינן זהות.' });
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
      setPasswordState({ status: 'success', message: 'הסיסמה עודכנה. שאר המכשירים נותקו מהחשבון.' });
      setSummary((previous) =>
        previous ? { ...previous, security: { ...previous.security, activeSessionCount: 1 } } : previous
      );
    } catch {
      if (!operation.isCurrent()) return;
      setPasswordState({ status: 'error', message: 'לא הצלחנו לאשר את עדכון הסיסמה. יש להתחבר מחדש ולבדוק.' });
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
      if (operation.isCurrent()) setActionError('לא הצלחנו לאשר את הפעולה. יש לבדוק את ההגדרות ולנסות שוב.');
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
  let notificationLabel = pushEnabled ? 'כיבוי התראות' : 'הפעלת התראות';
  let notificationDescription = pushEnabled
    ? 'ההתראות מופעלות במכשיר הזה.'
    : 'קבלת התראות מעקב וסריקות מתוזמנות גם כשהאפליקציה סגורה.';
  if (!canNotify) {
    notificationLabel = 'שדרוג להפעלת התראות';
    notificationDescription = 'התראות למכשיר כלולות ב־Elite ובתקופת הניסיון הפעילה.';
  } else if (notificationBlocked) {
    notificationLabel = 'חסום בהגדרות הדפדפן';
    notificationDescription = 'יש לאפשר התראות לאתר בהגדרות הדפדפן ולחזור לכאן.';
  } else if (notificationUnavailable) {
    notificationLabel = 'אינו זמין במכשיר הזה';
    notificationDescription =
      'באייפון: שיתוף ← הוספה למסך הבית. יש לפתוח משם ולהפעיל התראות. בדפדפנים אחרים יש לבדוק תמיכה בהתראות.';
  }

  const quota = usage.quota || {};
  let scanDetail = '—';
  if (quota.tier === 'elite') scanDetail = 'ללא הגבלה';
  else if (quota.tier === 'premium' && quota.premium) scanDetail = `${quota.premium.left}/${quota.premium.limit} נותרו`;
  else if (quota.free?.trialActive) scanDetail = 'ללא הגבלה בתקופת הניסיון';
  else if (quota.free) scanDetail = 'תקופת הניסיון הסתיימה';

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
                <div className="profile-modal-kicker">חשבון Capital Flow</div>
                <h2 id="profile-modal-title">מרכז החשבון</h2>
                <p>{account.email || '—'}</p>
              </div>
            </div>
            <div className="account-center-header-actions">
              <span className="account-center-tier">{accessLabel(account).toUpperCase()}</span>
              <button className="upgrade-close" onClick={onClose} aria-label="סגירת פרטי החשבון" type="button">
                ×
              </button>
            </div>
          </header>

          <div className={'account-center-layout' + (mobileNavOpen ? ' account-center-layout--mobile-nav' : '')}>
            <aside className="account-center-sidebar" aria-label="נושאי החשבון">
              <div className="account-center-nav-label">מרכז החשבון</div>
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

            <nav className="account-center-mobile-nav" aria-label="נושאי החשבון">
              <div className="account-center-nav-label">מרכז החשבון</div>
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
                aria-label="חזרה לנושאי החשבון"
              >
                ← כל נושאי החשבון
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
                      <SubsectionHeader eyebrow="פרטי החשבון" title="פרטי החשבון" />
                      <Section id="profile-section-overview">
                        <div className="profile-stat-grid profile-stat-grid--four">
                          <Stat
                            label="גישה"
                            value={accessLabel(account)}
                            detail={
                              plan.access === 'Full access'
                                ? 'גישה מלאה'
                                : plan.access === 'Limited access'
                                  ? 'גישה מוגבלת'
                                  : '—'
                            }
                          />
                          <Stat
                            label="אימות"
                            value={account.is_verified ? 'מאומת' : 'ממתין לאימות'}
                            detail="מצב אימות המייל"
                          />
                          <Stat
                            label="התחברות"
                            value={
                              provider === 'Email and password'
                                ? 'מייל וסיסמה'
                                : provider === 'Google'
                                  ? 'Google'
                                  : 'לא זמין'
                            }
                            detail="אופן התחברות"
                          />
                          <Stat label="הצטרפות" value={formatDate(account.created_at)} />
                        </div>
                      </Section>
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="גישה" title="מסלול וגישה" />
                      <Section id="profile-section-plan">
                        <div className="profile-modal-detail-list">
                          <div className="profile-modal-detail">
                            <span className="profile-modal-label">המסלול הנוכחי</span>
                            <strong className="profile-modal-value">{accessLabel(account)}</strong>
                          </div>
                          <div className="profile-modal-detail">
                            <span className="profile-modal-label">מצב תקופת הניסיון</span>
                            <span className="profile-modal-value">
                              {plan.trialActive
                                ? `Active · ends ${formatDate(plan.trialEndsAt)}`
                                : account.tier === 'free'
                                  ? 'לא פעילה'
                                  : 'לא רלוונטי'}
                            </span>
                          </div>
                        </div>
                        {onUpgrade && (
                          <button
                            className="profile-primary-btn account-center-plan-cta"
                            type="button"
                            onClick={onUpgrade}
                          >
                            הצגת אפשרויות שדרוג
                          </button>
                        )}
                      </Section>
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="פעילות" title="הפעילות שלך" />
                      <Section id="profile-section-usage">
                        {summaryState === 'loading' ? (
                          <div className="profile-modal-loading">טוענים את נתוני הפעילות…</div>
                        ) : summaryState === 'error' ? (
                          <div className="profile-modal-inline-error">{summaryError}</div>
                        ) : (
                          <div className="profile-stat-grid profile-stat-grid--four">
                            <Stat label="סריקות" value={scanDetail} detail="המכסה הנוכחית" />
                            <Stat label="רשימת מעקב" value={number(usage.watchlistCount)} detail="מניות שמורות" />
                            <Stat label="התראות" value={number(usage.alertCount)} detail="תנאים פעילים" />
                            <Stat
                              label="רדאר"
                              value={number(usage.activeRadarCount)}
                              detail={`${number(usage.radarCount)} כללים בסך הכול`}
                            />
                            <Stat
                              label="תזמונים"
                              value={number(usage.activeScheduleCount)}
                              detail={`${number(usage.scheduleCount)} total`}
                            />
                            <Stat label="מכשירים" value={number(usage.pushDeviceCount)} detail="מכשירים עם התראות" />
                            <Stat
                              label="חיבורים"
                              value={number(security.activeSessionCount)}
                              detail="מכשירים מחוברים"
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
                      <SubsectionHeader eyebrow="העדפות" title="התראות" />
                      <Section id="profile-section-notifications">
                        <div className="account-center-action-card">
                          <div>
                            <strong>גישה להתראות</strong>
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
                            {pushBusy ? 'מבצעים…' : notificationLabel}
                          </button>
                        </div>
                      </Section>
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="פעילות" title="תזמון סריקות" />
                      <Section id="profile-section-scheduling">
                        {scheduledScansState === 'loading' && (
                          <div className="account-center-schedule-state" role="status">
                            טוענים את הסריקות המתוזמנות שלך…
                          </div>
                        )}

                        {scheduledScansState === 'error' && (
                          <div className="account-center-schedule-state account-center-schedule-state--error">
                            <strong>הסריקות המתוזמנות אינן זמינות כרגע.</strong>
                            <span>{scheduledScansError}</span>
                            <button className="profile-secondary-btn" type="button" onClick={loadScheduledScans}>
                              ניסיון נוסף
                            </button>
                          </div>
                        )}

                        {scheduledScansState === 'ready' && scheduledScans.length === 0 && (
                          <div className="account-center-schedule-empty">
                            <div className="account-center-schedule-empty-icon" aria-hidden="true">
                              ◷
                            </div>
                            <strong>אין כרגע סריקות מתוזמנות.</strong>
                            <span>בחר שעה, והסריקה תתבצע עבורך באופן אוטומטי.</span>
                            <button className="profile-primary-btn" type="button" onClick={onOpenScheduling}>
                              תזמון סריקות
                            </button>
                          </div>
                        )}

                        {scheduledScansState === 'ready' && scheduledScans.length > 0 && (
                          <>
                            <div className="account-center-schedule-list" aria-label="הסריקות המתוזמנות שלך">
                              {scheduledScans.map((schedule) => {
                                const active = Boolean(schedule.active);
                                return (
                                  <article className="account-center-schedule-item" key={schedule.id}>
                                    <div className="account-center-schedule-item-copy">
                                      <div className="account-center-schedule-item-heading">
                                        <strong>{SCHEDULE_SCAN_LABELS[schedule.scan_type] || 'סריקה מתוזמנת'}</strong>
                                        <span
                                          className={'account-center-schedule-status' + (active ? ' is-active' : '')}
                                        >
                                          {active ? 'פעיל' : 'מושהה'}
                                        </span>
                                      </div>
                                      <span className="account-center-schedule-item-time">
                                        {scheduleTiming(schedule)}
                                      </span>
                                      <small>
                                        {schedule.scan_date ? 'סריקה חד־פעמית' : 'חוזר בכל יום'} · שעון ירושלים
                                        {schedule.last_run_at
                                          ? ` · הרצה אחרונה ${formatDateTime(schedule.last_run_at)}`
                                          : ' · טרם הופעל'}
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
                              תזמון סריקה נוספת
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
                      <SubsectionHeader eyebrow="אבטחה" title="אבטחה והתחברות" />
                      <Section id="profile-section-security">
                        <div className="profile-modal-detail-list">
                          <div className="profile-modal-detail">
                            <span className="profile-modal-label">התחברות אחרונה</span>
                            <span className="profile-modal-value">{formatDateTime(account.last_login_at)}</span>
                          </div>
                          <div className="profile-modal-detail">
                            <span className="profile-modal-label">חיבורים פעילים</span>
                            <span className="profile-modal-value">{number(security.activeSessionCount || 0)}</span>
                          </div>
                        </div>

                        {canChangePassword ? (
                          <form className="profile-password-form" onSubmit={submitPassword}>
                            <div className="profile-form-heading">שינוי סיסמה</div>
                            <input
                              className="auth-input profile-password-input"
                              type="password"
                              placeholder="סיסמה נוכחית"
                              autoComplete="current-password"
                              value={password.current}
                              onChange={(event) => updatePasswordField('current', event.target.value)}
                              aria-label="סיסמה נוכחית"
                            />
                            <input
                              className="auth-input profile-password-input"
                              type="password"
                              placeholder="סיסמה חדשה · לפחות 15 תווים"
                              minLength={15}
                              autoComplete="new-password"
                              value={password.next}
                              onChange={(event) => updatePasswordField('next', event.target.value)}
                              aria-label="סיסמה חדשה"
                            />
                            <input
                              className="auth-input profile-password-input"
                              type="password"
                              placeholder="אימות הסיסמה החדשה"
                              autoComplete="new-password"
                              value={password.confirm}
                              onChange={(event) => updatePasswordField('confirm', event.target.value)}
                              aria-label="אימות הסיסמה החדשה"
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
                              {passwordState.status === 'saving' ? 'מעדכנים…' : 'עדכון סיסמה'}
                            </button>
                          </form>
                        ) : (
                          <div className="profile-modal-info-box">
                            <strong>הסיסמה מנוהלת בחשבון Google</strong>
                            <span>ניתן לשנות אותה בהגדרות האבטחה של חשבון Google.</span>
                          </div>
                        )}

                        <button
                          className="profile-danger-link"
                          type="button"
                          onClick={() => setConfirmAction('logout-all')}
                        >
                          ניתוק כל המכשירים
                        </button>
                      </Section>
                    </div>

                    <div className="account-center-subsection">
                      <SubsectionHeader eyebrow="פרטיות" title="פרטיות ונתונים" />
                      <Section id="profile-section-privacy">
                        <div className="profile-privacy-actions">
                          <button
                            className="profile-secondary-btn"
                            type="button"
                            onClick={downloadData}
                            disabled={downloadState === 'loading'}
                          >
                            {downloadState === 'loading' ? 'מכינים…' : 'הורדת הנתונים שלי'}
                          </button>
                          <button className="profile-danger-btn" type="button" onClick={() => setShowDelete(true)}>
                            מחיקת חשבון
                          </button>
                        </div>
                        {downloadState === 'success' && (
                          <p className="profile-modal-form-message success">הורדת הנתונים החלה.</p>
                        )}
                        {downloadState === 'error' && (
                          <p className="profile-modal-form-message error">לא הצלחנו להכין את ההורדה. אפשר לנסות שוב.</p>
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
                <span className="profile-modal-section-eyebrow">אישור פעולה</span>
                <h3 id="profile-confirm-title">
                  {confirmAction === 'enable-notifications'
                    ? 'הפעלת התראות במכשיר הזה?'
                    : confirmAction === 'disable-notifications'
                      ? 'כיבוי התראות במכשיר הזה?'
                      : 'ניתוק כל המכשירים?'}
                </h3>
                <p>
                  {confirmAction === 'enable-notifications'
                    ? 'Capital Flow יוכל לשלוח התראות ותוצאות סריקות למכשיר הזה.'
                    : confirmAction === 'disable-notifications'
                      ? 'המכשיר הזה יפסיק לקבל התראות. ההתראות והתזמונים בחשבון יישארו שמורים.'
                      : 'גם הדפדפן הנוכחי ינותק. יהיה צורך להתחבר מחדש בכל המכשירים.'}
                </p>
                {actionError && <div className="profile-modal-form-message error">{actionError}</div>}
                <div className="profile-confirm-actions">
                  <button className="profile-secondary-btn" type="button" onClick={() => setConfirmAction(null)}>
                    ביטול
                  </button>
                  <button className="profile-primary-btn" type="button" onClick={confirmSensitiveAction}>
                    אישור
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
