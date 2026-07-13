import React, { useState } from 'react';
import useScheduledScans from '../../hooks/useScheduledScans';

const SCAN_LABELS = {
  capitalFlow: 'Capital Flow',
  maScanner: 'MA Scanner',
  sectorMoving: 'Sector Flow',
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(Number(iso) * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ScheduleScan({ scanType, user, onUpgrade }) {
  const isElite = !!(user && user.tier === 'elite');
  const { mySchedules, loading, error, addSchedule, toggleSchedule, removeSchedule } =
    useScheduledScans(scanType);

  const [open, setOpen] = useState(false);
  const [timeInput, setTimeInput] = useState('09:30');
  const [adding, setAdding] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    setAdding(true);
    await addSchedule(timeInput);
    setAdding(false);
  }

  return (
    <>
      <button
        className="schedule-scan-btn"
        onClick={() => setOpen(true)}
        title="Schedule automatic scan"
        aria-label="Schedule automatic scan"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Schedule
        {mySchedules.filter((s) => s.active).length > 0 && (
          <span className="schedule-scan-badge">{mySchedules.filter((s) => s.active).length}</span>
        )}
      </button>

      {open && (
        <div className="upgrade-overlay" onClick={() => setOpen(false)}>
          <div
            className="schedule-scan-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Schedule Scan"
          >
            <div className="schedule-scan-header">
              <div className="schedule-scan-title-row">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>Schedule {SCAN_LABELS[scanType]}</span>
              </div>
              <button className="schedule-scan-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            {!isElite ? (
              <div className="schedule-scan-upsell">
                <div className="schedule-scan-upsell-icon">⏰</div>
                <p className="schedule-scan-upsell-title">Automated Scans</p>
                <p className="schedule-scan-upsell-desc">
                  Schedule {SCAN_LABELS[scanType]} to run automatically at your chosen time — even
                  when the app is closed. You&apos;ll get a push notification the moment results are
                  ready.
                </p>
                <p className="schedule-scan-upsell-tag">Elite feature</p>
                <button
                  className="upgrade-cta"
                  onClick={() => { setOpen(false); onUpgrade?.(); }}
                >
                  Upgrade to Elite
                </button>
              </div>
            ) : (
              <>
                <form className="schedule-scan-form" onSubmit={handleAdd}>
                  <label className="schedule-scan-label" htmlFor="scan-time-input">
                    Run daily at (Jerusalem time)
                  </label>
                  <div className="schedule-scan-input-row">
                    <input
                      id="scan-time-input"
                      type="time"
                      className="schedule-scan-time-input"
                      value={timeInput}
                      onChange={(e) => setTimeInput(e.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="schedule-scan-add-btn"
                      disabled={adding || loading}
                    >
                      {adding ? 'Adding…' : '+ Add'}
                    </button>
                  </div>
                  {error && <p className="schedule-scan-error">{error}</p>}
                </form>

                <div className="schedule-scan-list">
                  {mySchedules.length === 0 ? (
                    <p className="schedule-scan-empty">
                      No schedules yet. Add one above and we&apos;ll run the scan automatically.
                    </p>
                  ) : (
                    mySchedules.map((s) => (
                      <div key={s.id} className={'schedule-scan-item' + (s.active ? '' : ' schedule-scan-item--off')}>
                        <div className="schedule-scan-item-info">
                          <span className="schedule-scan-item-time">{s.scan_time}</span>
                          {s.last_run_at && (
                            <span className="schedule-scan-item-last">
                              Last ran {fmtTime(s.last_run_at)}
                              {s.last_result_count != null ? ` · ${s.last_result_count} results` : ''}
                            </span>
                          )}
                        </div>
                        <div className="schedule-scan-item-actions">
                          <button
                            className={'schedule-scan-toggle' + (s.active ? ' schedule-scan-toggle--on' : '')}
                            onClick={() => toggleSchedule(s.id, !s.active)}
                            title={s.active ? 'Pause' : 'Resume'}
                            aria-label={s.active ? 'Pause schedule' : 'Resume schedule'}
                          >
                            {s.active ? '⏸' : '▶'}
                          </button>
                          <button
                            className="schedule-scan-delete"
                            onClick={() => removeSchedule(s.id)}
                            title="Delete"
                            aria-label="Delete schedule"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <p className="schedule-scan-footer">
                  Push notifications required. Max 3 active schedules.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
