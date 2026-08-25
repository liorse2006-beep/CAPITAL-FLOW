import React, { useCallback, useEffect, useMemo, useState } from 'react';

const DATA_UNAVAILABLE = 'Data is not available right now. Try again in a few minutes.';

function modeLabel(radar) {
  if (radar.mode === 'sp500') return 'S&P 500';
  if (radar.mode === 'nasdaq100') return 'NASDAQ 100';
  if (radar.mode === 'sectors') return radar.selectedSectors.join(' · ');
  return 'Full market';
}

function formatCap(value) {
  const billions = Number(value || 0) / 1e9;
  return '$' + (billions >= 10 ? billions.toFixed(0) : billions.toFixed(1)) + 'B cap';
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function todayIsrael() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Date(year, month - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function dataLine(radar) {
  if (radar.dataStatus === 'unavailable') return radar.statusMessage || DATA_UNAVAILABLE;
  if (radar.dataStatus === 'partial')
    return radar.statusMessage || 'Some market data is unavailable right now. Try again in a few minutes.';
  if (radar.dataStatus === 'waiting') return radar.statusMessage || 'Waiting for the first completed market scan.';
  if (radar.dataStatus === 'needs_schedule' || radar.dataStatus === 'expired')
    return radar.statusMessage || 'Choose a new Radar schedule.';
  return null;
}

export default function CapitalFlowRadar({
  user,
  getToken,
  isElite,
  trialActive,
  onUpgrade,
  onSignIn,
  scanMode,
  selectedSectors,
  minRatio,
  minCap,
  minVol,
  radarEvent,
}) {
  const [radars, setRadars] = useState([]);
  const [loading, setLoading] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [editingRadarId, setEditingRadarId] = useState(null);
  const [name, setName] = useState('');
  const [scheduleTime1, setScheduleTime1] = useState('');
  const [scheduleTime2, setScheduleTime2] = useState('');
  const [expiresOn, setExpiresOn] = useState(todayIsrael());
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const headers = useCallback(() => ({ Authorization: 'Bearer ' + (getToken ? getToken() : '') }), [getToken]);
  const radarAccess = !!user && (isElite || trialActive);

  const loadRadars = useCallback(() => {
    if (!radarAccess) {
      setRadars([]);
      return Promise.resolve();
    }
    setLoading(true);
    setError('');
    return fetch('/api/radars', { headers: headers() })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Radar data is temporarily unavailable.');
        return data;
      })
      .then((data) => setRadars(Array.isArray(data.radars) ? data.radars : []))
      .catch((err) => setError(err.message || DATA_UNAVAILABLE))
      .finally(() => setLoading(false));
  }, [headers, radarAccess]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadRadars(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRadars, refreshKey]);

  useEffect(() => {
    if (!radarEvent) return;
    const timer = window.setTimeout(() => loadRadars(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRadars, radarEvent]);

  const latestEvent = radarEvent;

  const recipe = useMemo(
    () => ({
      mode: scanMode === 'sp500' || scanMode === 'nasdaq100' || scanMode === 'sectors' ? scanMode : 'all',
      selectedSectors: scanMode === 'sectors' ? selectedSectors : [],
      minVolumeRatio: Number(minRatio),
      minMarketCap: Number(minCap) * 1e9,
      minVolRaw: minVol || '',
    }),
    [minCap, minRatio, minVol, scanMode, selectedSectors]
  );

  function closeSetup() {
    setSetupOpen(false);
    setEditingRadarId(null);
    setName('');
    setScheduleTime1('');
    setScheduleTime2('');
    setExpiresOn(todayIsrael());
  }

  function openSetupForRadar(radar) {
    setEditingRadarId(radar ? radar.id : null);
    setName(radar ? radar.name : '');
    setScheduleTime1(radar?.scheduleTime1 || '');
    setScheduleTime2(radar?.scheduleTime2 || '');
    setExpiresOn(radar?.expiresOn || todayIsrael());
    setError('');
    setSetupOpen(true);
  }

  function activateRadar() {
    if (!scheduleTime1) {
      setError('Choose at least one scan time.');
      return;
    }
    if (scheduleTime2 && scheduleTime1 === scheduleTime2) {
      setError('Choose two different scan times.');
      return;
    }
    if (!expiresOn) {
      setError('Choose the last date on which this Radar may run.');
      return;
    }
    setLoading(true);
    setError('');
    const editing = editingRadarId !== null;
    fetch(editing ? '/api/radars/' + editingRadarId : '/api/radars', {
      method: editing ? 'PUT' : 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || 'Capital Flow Radar',
        ...recipe,
        scheduleTime1,
        scheduleTime2: scheduleTime2 || null,
        expiresOn,
        ...(editing ? { active: true } : {}),
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Radar could not be created right now.');
        return data;
      })
      .then((data) => {
        if (data.radar) {
          setRadars((prev) =>
            editing
              ? prev.map((item) => (item.id === editingRadarId ? { ...item, ...data.radar } : item))
              : [data.radar, ...prev]
          );
        }
        closeSetup();
      })
      .catch((err) =>
        setError(
          err.message || (editing ? 'Radar could not be updated right now.' : 'Radar could not be created right now.')
        )
      )
      .finally(() => setLoading(false));
  }

  function updateRadar(id, body) {
    setError('');
    fetch('/api/radars/' + id, {
      method: 'PUT',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Radar could not be updated right now.');
        return data;
      })
      .then((data) => {
        if (data.radar) setRadars((prev) => prev.map((item) => (item.id === id ? data.radar : item)));
      })
      .catch((err) => setError(err.message || 'Radar could not be updated right now.'));
  }

  function removeRadar(id) {
    if (!window.confirm('Remove this Capital Flow Radar?')) return;
    setError('');
    fetch('/api/radars/' + id, { method: 'DELETE', headers: headers() })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Radar could not be removed right now.');
        return data;
      })
      .then(() => setRadars((prev) => prev.filter((item) => item.id !== id)))
      .catch((err) => setError(err.message || 'Radar could not be removed right now.'));
  }

  const locked = !radarAccess;
  const hasActiveScheduledRadar = radars.some(
    (radar) => radar.active && radar.dataStatus !== 'expired' && radar.dataStatus !== 'needs_schedule'
  );

  return (
    <section className="cfr-radar-panel" aria-labelledby="capital-flow-radar-title">
      <div className="cfr-radar-topline">
        <div className="cfr-radar-brand">
          <span className="cfr-radar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 12 18.2 5.8M3.5 12h17M12 3.5v17" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </span>
          <div>
            <span className="cfr-radar-kicker">CAPITAL FLOW / RADAR</span>
            <h3 id="capital-flow-radar-title">Catch the moment a setup appears.</h3>
          </div>
        </div>
        <span className={'cfr-radar-state' + (locked ? ' locked' : hasActiveScheduledRadar ? ' on' : '')}>
          {locked
            ? !user
              ? 'SIGN IN TO ACTIVATE'
              : 'ELITE ACCESS ONLY'
            : hasActiveScheduledRadar
              ? 'SCHEDULED'
              : 'READY TO SCHEDULE'}
        </span>
      </div>

      <p className="cfr-radar-copy">
        Save this scan once. Choose up to two different times during the trading day and an expiry date. Capital Flow
        checks the market only in those windows and alerts you when a symbol enters the criteria for the first time.
      </p>

      <div className="cfr-radar-proof">
        <span>
          <b>ONE</b> alert per new entry
        </span>
        <span>
          <b>UP TO 2</b> scans per day
        </span>
        <span>
          <b>UNTIL</b> your expiry date
        </span>
        <span>
          <b>NO</b> invented data
        </span>
      </div>

      {locked ? (
        <div className="cfr-radar-locked">
          <span>
            {user
              ? 'Radar is available during the 7-day trial and with Elite access. Premium does not include Radar.'
              : 'Sign in to activate Radar and keep a scan running when you are away.'}
          </span>
          <button className="cfr-radar-cta" type="button" onClick={user ? onUpgrade : onSignIn}>
            {user ? 'Unlock with Elite' : 'Sign in to activate'} <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : (
        <>
          {radars.map((radar) => {
            const unavailableMessage = dataLine(radar);
            return (
              <article className="cfr-radar-item" key={radar.id}>
                <div className="cfr-radar-item-head">
                  <div>
                    <div className="cfr-radar-item-title">
                      <span className={'cfr-radar-dot ' + (radar.active ? 'active' : 'paused')} />
                      {radar.name}
                    </div>
                    <div className="cfr-radar-recipe">
                      {modeLabel(radar)} <span>·</span> {Number(radar.minVolumeRatio).toFixed(1)}x RVOL <span>·</span>{' '}
                      {formatCap(radar.minMarketCap)}
                    </div>
                  </div>
                  <span className={'cfr-radar-data-status ' + radar.dataStatus}>
                    {radar.dataStatus === 'ready'
                      ? 'DATA READY'
                      : radar.dataStatus === 'partial'
                        ? 'PARTIAL DATA'
                        : radar.dataStatus === 'waiting'
                          ? 'WAITING'
                          : 'DATA UNAVAILABLE'}
                  </span>
                </div>

                <div className="cfr-radar-meta">
                  <span>
                    Last check <b>{formatTime(radar.lastCheckAt)}</b>
                  </span>
                  <span>
                    Scan times{' '}
                    <b>{[radar.scheduleTime1, radar.scheduleTime2].filter(Boolean).join(' · ') || 'Not set'}</b>
                  </span>
                  <span>
                    Until <b>{formatDate(radar.expiresOn)}</b>
                  </span>
                </div>

                {unavailableMessage && (
                  <div className={'cfr-radar-data-note ' + radar.dataStatus} role="status">
                    <span aria-hidden="true">!</span> {unavailableMessage}
                  </div>
                )}

                {radar.events && radar.events.length > 0 && (
                  <div className="cfr-radar-events">
                    <div className="cfr-radar-events-label">RECENT ENTRIES</div>
                    {radar.events.slice(0, 3).map((event) => (
                      <div className="cfr-radar-event" key={event.id}>
                        <span className="cfr-radar-event-symbol">{event.symbol}</span>
                        <span className="cfr-radar-event-data">
                          {event.data && Number.isFinite(Number(event.data.volumeRatio))
                            ? Number(event.data.volumeRatio).toFixed(2) + 'x RVOL'
                            : 'Verified scan entry'}
                        </span>
                        <time dateTime={event.scanTime}>{formatTime(event.scanTime)}</time>
                      </div>
                    ))}
                  </div>
                )}

                <div className="cfr-radar-controls">
                  <button type="button" onClick={() => openSetupForRadar(radar)}>
                    {radar.dataStatus === 'expired' || radar.dataStatus === 'needs_schedule'
                      ? 'Set schedule'
                      : 'Edit schedule'}
                  </button>
                  <button type="button" onClick={() => updateRadar(radar.id, { active: !radar.active })}>
                    {radar.active ? 'Pause' : 'Resume'}
                  </button>
                  <button type="button" onClick={() => removeRadar(radar.id)} className="danger">
                    Remove
                  </button>
                </div>
              </article>
            );
          })}

          {latestEvent && (
            <div className="cfr-radar-live-event" role="status" aria-live="polite">
              <span className="cfr-radar-live-pulse" />
              <span>
                <b>{latestEvent.symbol}</b> just entered a saved Radar
              </span>
            </div>
          )}

          {setupOpen ? (
            <div className="cfr-radar-setup">
              <div className="cfr-radar-setup-label">
                {editingRadarId !== null ? 'UPDATE RADAR SCHEDULE' : 'SCHEDULE THIS SCAN'}
              </div>
              <input
                type="text"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Radar name (optional)"
                aria-label="Radar name"
              />
              <div className="cfr-radar-schedule-picker">
                <div className="cfr-radar-schedule-heading">Choose up to 2 scan times · Jerusalem time</div>
                <div className="cfr-radar-schedule-grid">
                  <label>
                    <span>First scan</span>
                    <input
                      type="time"
                      value={scheduleTime1}
                      onChange={(event) => setScheduleTime1(event.target.value)}
                      required
                      aria-label="First daily Radar scan time"
                    />
                  </label>
                  <label>
                    <span>
                      Second scan <em>optional</em>
                    </span>
                    <input
                      type="time"
                      value={scheduleTime2}
                      onChange={(event) => setScheduleTime2(event.target.value)}
                      aria-label="Second daily Radar scan time"
                    />
                  </label>
                  <label className="cfr-radar-expiry-field">
                    <span>Active through</span>
                    <input
                      type="date"
                      value={expiresOn}
                      min={todayIsrael()}
                      onChange={(event) => setExpiresOn(event.target.value)}
                      required
                      aria-label="Radar expiry date"
                    />
                  </label>
                </div>
                <p className="cfr-radar-schedule-note">
                  The Radar runs only in the selected windows during regular U.S. market hours. Weekends and
                  closed-market periods are skipped. The expiry date is inclusive.
                </p>
              </div>
              <div className="cfr-radar-current-recipe">
                {modeLabel(recipe)} <span>·</span> {Number(recipe.minVolumeRatio || 0).toFixed(1)}x RVOL <span>·</span>{' '}
                {formatCap(recipe.minMarketCap)}
              </div>
              {recipe.mode === 'sectors' && recipe.selectedSectors.length === 0 && (
                <div className="cfr-radar-form-error">Choose at least one sector before activating this Radar.</div>
              )}
              <div className="cfr-radar-setup-actions">
                <button
                  type="button"
                  className="cfr-radar-cta"
                  onClick={activateRadar}
                  disabled={loading || (recipe.mode === 'sectors' && recipe.selectedSectors.length === 0)}
                >
                  Activate Radar <span aria-hidden="true">→</span>
                </button>
                <button type="button" className="cfr-radar-cancel" onClick={closeSetup}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="cfr-radar-activate"
              onClick={() => openSetupForRadar(null)}
              disabled={radars.length >= 3}
              title={radars.length >= 3 ? 'Maximum of three Radar recipes' : undefined}
            >
              <span className="cfr-radar-plus" aria-hidden="true">
                +
              </span>
              {radars.length ? 'Save another Radar from these filters' : 'Activate this scan as Radar'}
            </button>
          )}

          {error && (
            <div className="cfr-radar-error" role="alert">
              {error}
            </div>
          )}
          <button
            type="button"
            className="cfr-radar-refresh"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={loading}
          >
            {loading ? 'Checking…' : 'Refresh Radar status'}
          </button>
        </>
      )}
    </section>
  );
}
