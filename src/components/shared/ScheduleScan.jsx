import React, { useEffect, useState } from 'react';
import useScheduledScans from '../../hooks/useScheduledScans';
import NotificationChoice from './NotificationChoice';
import { friendlyError } from '../../utils/format';
import useModalA11y from '../../hooks/useModalA11y';

const SCAN_LABELS = {
  capitalFlow: 'Capital Flow',
  maScanner: 'סורק ממוצעים נעים',
  sectorMoving: 'פעילות בסקטורים',
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(Number(iso) * 1000);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { month: 'short', day: 'numeric' });
}

function todayLocalDate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function ScheduleScan({
  scanType,
  user,
  onUpgrade,
  onSignIn,
  pushSupported,
  pushEnabled,
  pushBusy,
  pushError,
  onEnablePush,
}) {
  // Scheduled scans are a full כלול ב־Elite, included in the 7-day free
  // trial — user.elite_access is true for Elite AND in-trial free accounts.
  const hasAccess = !!(user && (user.tier === 'elite' || user.elite_access));
  const { mySchedules, loading, error, addSchedule, toggleSchedule, removeSchedule } = useScheduledScans(scanType);

  const [open, setOpen] = useState(false);
  const [timeInput, setTimeInput] = useState('09:30');
  // "once" is the default on purpose — a schedule the customer sets should
  // run once for the date+time they actually chose, not silently turn into
  // a standing daily job unless they deliberately pick "בכל יום".
  const [repeatMode, setRepeatMode] = useState('once');
  const [dateInput, setDateInput] = useState(todayLocalDate());
  const [adding, setAdding] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState(null);
  const panelRef = useModalA11y(closeSchedule, open && !pendingSchedule);

  // The profile's single "Scan Scheduling" action opens the scheduler that
  // already belongs to the active scanner. A DOM event keeps this component
  // reusable across the three scanner pages without duplicating its API/UI.
  useEffect(() => {
    function openFromProfile(event) {
      const requestedType = event.detail && event.detail.scanType;
      if (requestedType && requestedType !== scanType) return;
      if (user) setOpen(true);
    }
    window.addEventListener('capital-flow:open-schedule', openFromProfile);
    return () => window.removeEventListener('capital-flow:open-schedule', openFromProfile);
  }, [scanType, user]);

  function closeSchedule() {
    setOpen(false);
    setPendingSchedule(null);
  }

  async function persistSchedule(schedule) {
    if (!schedule || adding) return false;
    setAdding(true);
    try {
      const saved = await addSchedule(schedule.scanTime, schedule.scanDate);
      if (saved !== false) setPendingSchedule(null);
      return saved !== false;
    } finally {
      setAdding(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    const schedule = {
      scanTime: timeInput,
      scanDate: repeatMode === 'once' ? dateInput : null,
    };
    if (!pushEnabled) {
      setPendingSchedule(schedule);
      return;
    }
    await persistSchedule(schedule);
  }

  async function enablePushAndSaveSchedule() {
    if (!pendingSchedule || typeof onEnablePush !== 'function') return;
    await onEnablePush();
    await persistSchedule(pendingSchedule);
  }

  return (
    <>
      <button
        className="schedule-scan-btn"
        onClick={() => (user ? setOpen(true) : onSignIn && onSignIn())}
        title="תזמון סריקה אוטומטית"
        aria-label="תזמון סריקה אוטומטית"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        תזמון
        {mySchedules.filter((s) => s.active).length > 0 && (
          <span className="schedule-scan-badge">{mySchedules.filter((s) => s.active).length}</span>
        )}
      </button>

      {open && (
        <div className="upgrade-overlay" onClick={closeSchedule}>
          <div
            className="schedule-scan-panel"
            ref={panelRef}
            tabIndex={-1}
            dir="rtl"
            lang="he"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="תזמון סריקה"
          >
            <div className="schedule-scan-header">
              <div className="schedule-scan-title-row">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>תזמון {SCAN_LABELS[scanType]}</span>
              </div>
              <button className="schedule-scan-close" onClick={closeSchedule} aria-label="סגירה">
                ✕
              </button>
            </div>

            {!hasAccess ? (
              <div className="schedule-scan-upsell">
                <div className="schedule-scan-upsell-icon">⏰</div>
                <p className="schedule-scan-upsell-title">סריקות אוטומטיות</p>
                <p className="schedule-scan-upsell-desc">
                  תזמון {SCAN_LABELS[scanType]} לשעה שתבחר, גם כשהאפליקציה סגורה. התוצאות יישמרו בחשבון, ויישלחו למכשיר
                  אם ההתראות מופעלות.
                </p>
                <p className="schedule-scan-upsell-tag">כלול ב־Elite</p>
                <button
                  className="upgrade-cta"
                  onClick={() => {
                    setOpen(false);
                    onUpgrade?.();
                  }}
                >
                  שדרוג ל־Elite
                </button>
              </div>
            ) : (
              <>
                {pendingSchedule && (
                  <NotificationChoice
                    pushSupported={pushSupported}
                    pushBusy={pushBusy}
                    pushError={pushError}
                    actionBusy={adding}
                    onEnable={enablePushAndSaveSchedule}
                    onContinue={() => persistSchedule(pendingSchedule)}
                    onCancel={() => setPendingSchedule(null)}
                  />
                )}
                <form className="schedule-scan-form" onSubmit={handleAdd}>
                  <div className="schedule-scan-repeat-toggle" role="radiogroup" aria-label="תדירות">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={repeatMode === 'once'}
                      className={'schedule-scan-repeat-btn' + (repeatMode === 'once' ? ' active' : '')}
                      onClick={() => setRepeatMode('once')}
                    >
                      פעם אחת
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={repeatMode === 'daily'}
                      className={'schedule-scan-repeat-btn' + (repeatMode === 'daily' ? ' active' : '')}
                      onClick={() => setRepeatMode('daily')}
                    >
                      בכל יום
                    </button>
                  </div>

                  <label className="schedule-scan-label" htmlFor="scan-time-input">
                    {repeatMode === 'once' ? 'מועד הסריקה החד־פעמית (שעון ירושלים)' : 'שעה יומית (שעון ירושלים)'}
                  </label>
                  <div className="schedule-scan-input-row">
                    {repeatMode === 'once' && (
                      <input
                        id="scan-date-input"
                        type="date"
                        className="schedule-scan-date-input"
                        value={dateInput}
                        min={todayLocalDate()}
                        onChange={(e) => setDateInput(e.target.value)}
                        required
                        aria-label="תאריך"
                      />
                    )}
                    <input
                      id="scan-time-input"
                      type="time"
                      className="schedule-scan-time-input"
                      value={timeInput}
                      onChange={(e) => setTimeInput(e.target.value)}
                      required
                    />
                    <button type="submit" className="schedule-scan-add-btn" disabled={adding || loading}>
                      {adding ? 'מוסיפים…' : '+ הוספה'}
                    </button>
                  </div>
                  {error && <p className="schedule-scan-error">{friendlyError(error)}</p>}
                </form>

                <div className="schedule-scan-list">
                  {mySchedules.length === 0 ? (
                    <p className="schedule-scan-empty">אין עדיין תזמונים. אפשר להוסיף תזמון לסריקה אוטומטית.</p>
                  ) : (
                    mySchedules.map((s) => (
                      <div key={s.id} className={'schedule-scan-item' + (s.active ? '' : ' schedule-scan-item--off')}>
                        <div className="schedule-scan-item-info">
                          <span className="schedule-scan-item-time">
                            {s.scan_date ? `${fmtDate(s.scan_date)}, ${s.scan_time}` : s.scan_time}
                          </span>
                          <span className="schedule-scan-item-repeat">{s.scan_date ? 'חד־פעמי' : 'חוזר בכל יום'}</span>
                          {s.last_run_at && (
                            <span className="schedule-scan-item-last">
                              הרצה אחרונה {fmtTime(s.last_run_at)}
                              {s.last_result_count != null ? ` · ${s.last_result_count} results` : ''}
                            </span>
                          )}
                        </div>
                        <div className="schedule-scan-item-actions">
                          <button
                            className={'schedule-scan-toggle' + (s.active ? ' schedule-scan-toggle--on' : '')}
                            onClick={() => toggleSchedule(s.id, !s.active)}
                            title={s.active ? 'השהיה' : 'הפעלה מחדש'}
                            aria-label={s.active ? 'השהיית תזמון' : 'הפעלת תזמון מחדש'}
                          >
                            {s.active ? '⏸' : '▶'}
                          </button>
                          <button
                            className="schedule-scan-delete"
                            onClick={() => removeSchedule(s.id)}
                            title="מחיקה"
                            aria-label="מחיקת תזמון"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <p className="schedule-scan-footer">התוצאות נשמרות גם בהתראות באפליקציה. עד שלושה תזמונים פעילים.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
