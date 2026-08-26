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

function formatRadarTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return value || '—';
  const hour = Number(match[1]);
  const minute = match[2];
  const displayHour = hour % 12 || 12;
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${displayHour}:${minute} ${period}`;
}

const RADAR_TIME_OPTIONS = Array.from({ length: 25 }, (_, index) => {
  const totalMinutes = 11 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { value, label: formatRadarTime(value) };
});

const RADAR_SECTORS = [
  'Technology',
  'Financials',
  'Health Care',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Industrials',
  'Materials',
  'Real Estate',
  'Utilities',
  'Communication Services',
  'Semiconductors',
];
const RADAR_MA_PERIODS = [9, 20, 50, 150];
const RADAR_MA_DISTANCES = [1, 2];
const RADAR_MA_DIRECTIONS = [
  { value: 'all', label: 'All' },
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
];

function formatVolumeInput(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '';
  if (number >= 1e9) return `${number / 1e9}B`;
  if (number >= 1e6) return `${number / 1e6}M`;
  if (number >= 1e3) return `${number / 1e3}K`;
  return String(number);
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
  const [draftRecipe, setDraftRecipe] = useState(null);
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
      minPrice: 0,
      maxPrice: 0,
      maPeriod: 20,
      maDistance: 2,
      maInterval: '1d',
      maDirection: 'all',
    }),
    [minCap, minRatio, minVol, scanMode, selectedSectors]
  );

  const currentRecipe = draftRecipe || recipe;

  function radarRecipeFromRow(radar) {
    return {
      mode: radar.mode || 'all',
      selectedSectors: Array.isArray(radar.selectedSectors) ? radar.selectedSectors : [],
      minVolumeRatio: Number(radar.minVolumeRatio || 1.5),
      minMarketCap: Number(radar.minMarketCap || 500_000_000),
      minVolRaw: formatVolumeInput(radar.minVolume),
      minPrice: Number(radar.minPrice || 0),
      maxPrice: Number(radar.maxPrice || 0),
      maPeriod: Number(radar.maPeriod || 20),
      maDistance: Number(radar.maDistance || 2),
      maInterval: radar.maInterval || '1d',
      maDirection: radar.maDirection || 'all',
    };
  }

  function closeSetup() {
    setSetupOpen(false);
    setEditingRadarId(null);
    setName('');
    setScheduleTime1('');
    setScheduleTime2('');
    setExpiresOn(todayIsrael());
    setDraftRecipe(null);
  }

  function openSetupForRadar(radar) {
    setEditingRadarId(radar ? radar.id : null);
    setName(radar ? radar.name : '');
    setScheduleTime1(radar?.scheduleTime1 || '');
    setScheduleTime2(radar?.scheduleTime2 || '');
    setExpiresOn(radar?.expiresOn || todayIsrael());
    setDraftRecipe(radar ? radarRecipeFromRow(radar) : { ...recipe });
    setError('');
    setSetupOpen(true);
  }

  function updateDraftRecipe(key, value) {
    setDraftRecipe((previous) => ({ ...(previous || recipe), [key]: value }));
    setError('');
  }

  function toggleDraftSector(sector) {
    setDraftRecipe((previous) => {
      const base = previous || recipe;
      const sectors = base.selectedSectors.includes(sector)
        ? base.selectedSectors.filter((item) => item !== sector)
        : [...base.selectedSectors, sector];
      return { ...base, selectedSectors: sectors };
    });
    setError('');
  }

  function activateRadar() {
    const selectedRecipe = draftRecipe || recipe;
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
    if (selectedRecipe.mode === 'sectors' && selectedRecipe.selectedSectors.length === 0) {
      setError('Choose at least one sector before activating this Radar.');
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
        ...selectedRecipe,
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
        Choose up to two daily check times and an expiry date. Radar checks only in those windows and alerts you when a
        symbol first matches the criteria.
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
                      {formatCap(radar.minMarketCap)} <span>·</span> SMA{radar.maPeriod || 20} ±
                      {Number(radar.maDistance || 2).toFixed(0)}% {radar.maDirection && radar.maDirection !== 'all' ? radar.maDirection : ''}
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
                    <b>
                      {[radar.scheduleTime1, radar.scheduleTime2].filter(Boolean).map(formatRadarTime).join(' · ') ||
                        'Not set'}
                    </b>
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
              <div className="cfr-radar-condition-block">
                <div className="cfr-radar-condition-heading">
                  <span>RADAR FILTERS</span>
                  <small>Both signal layers must match before an alert is sent.</small>
                </div>
                <div className="cfr-radar-filter-section">
                  <div className="cfr-radar-filter-section-heading">
                    <span>CAPITAL FLOW</span>
                    <small>Choose where to scan and the minimum activity.</small>
                  </div>
                  <div className="cfr-radar-filter-grid">
                    <label className="cfr-radar-filter cfr-radar-filter-wide">
                      <span>Universe</span>
                      <select
                        value={currentRecipe.mode}
                        onChange={(event) =>
                          updateDraftRecipe('mode', event.target.value === 'sectors' ? 'sectors' : event.target.value)
                        }
                        aria-label="Radar market universe"
                      >
                        <option value="all">All stocks</option>
                        <option value="sp500">S&amp;P 500</option>
                        <option value="nasdaq100">NASDAQ 100</option>
                        <option value="sectors">Selected sectors</option>
                      </select>
                    </label>
                    <label className="cfr-radar-filter">
                      <span>Min RVOL</span>
                      <input
                        type="number"
                        min="1.5"
                        max="100"
                        step="0.1"
                        value={currentRecipe.minVolumeRatio}
                        onChange={(event) => updateDraftRecipe('minVolumeRatio', event.target.value)}
                        aria-label="Minimum relative volume"
                      />
                    </label>
                    <label className="cfr-radar-filter">
                      <span>Min cap ($B)</span>
                      <input
                        type="number"
                        min="0.5"
                        max="100000"
                        step="0.1"
                        value={(Number(currentRecipe.minMarketCap || 0) / 1e9).toString()}
                        onChange={(event) => updateDraftRecipe('minMarketCap', Number(event.target.value) * 1e9)}
                        aria-label="Minimum market capitalization in billions"
                      />
                    </label>
                    <label className="cfr-radar-filter">
                      <span>Min volume</span>
                      <input
                        type="text"
                        value={currentRecipe.minVolRaw}
                        onChange={(event) => updateDraftRecipe('minVolRaw', event.target.value.toUpperCase())}
                        placeholder="Optional"
                        aria-label="Minimum trading volume"
                      />
                    </label>
                    <label className="cfr-radar-filter">
                      <span>Min price</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={currentRecipe.minPrice || ''}
                        onChange={(event) => updateDraftRecipe('minPrice', Number(event.target.value || 0))}
                        placeholder="Any"
                        aria-label="Minimum price"
                      />
                    </label>
                    <label className="cfr-radar-filter">
                      <span>Max price</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={currentRecipe.maxPrice || ''}
                        onChange={(event) => updateDraftRecipe('maxPrice', Number(event.target.value || 0))}
                        placeholder="Any"
                        aria-label="Maximum price"
                      />
                    </label>
                  </div>
                  {currentRecipe.mode === 'sectors' && (
                    <div className="cfr-radar-sector-picker">
                      <span>Sectors</span>
                      <div className="cfr-radar-sector-grid">
                        {RADAR_SECTORS.map((sector) => (
                          <button
                            type="button"
                            key={sector}
                            className={currentRecipe.selectedSectors.includes(sector) ? 'active' : ''}
                            aria-pressed={currentRecipe.selectedSectors.includes(sector)}
                            onClick={() => toggleDraftSector(sector)}
                          >
                            {sector}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="cfr-radar-filter-section cfr-radar-ma-section">
                  <div className="cfr-radar-filter-section-heading">
                    <span>MOVING AVERAGE</span>
                    <small>Set the SMA condition that must confirm the flow signal.</small>
                  </div>
                  <div className="cfr-radar-ma-controls">
                  <div className="cfr-radar-option-group">
                    <span>SMA period</span>
                    <div className="cfr-radar-option-row">
                      {RADAR_MA_PERIODS.map((period) => (
                        <button
                          type="button"
                          key={period}
                          className={Number(currentRecipe.maPeriod) === period ? 'active' : ''}
                          aria-pressed={Number(currentRecipe.maPeriod) === period}
                          onClick={() => updateDraftRecipe('maPeriod', period)}
                        >
                          {period}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cfr-radar-option-group">
                    <span>Distance</span>
                    <div className="cfr-radar-option-row">
                      {RADAR_MA_DISTANCES.map((distance) => (
                        <button
                          type="button"
                          key={distance}
                          className={Number(currentRecipe.maDistance) === distance ? 'active' : ''}
                          aria-pressed={Number(currentRecipe.maDistance) === distance}
                          onClick={() => updateDraftRecipe('maDistance', distance)}
                        >
                          ±{distance}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cfr-radar-option-group">
                    <span>Direction</span>
                    <div className="cfr-radar-option-row">
                      {RADAR_MA_DIRECTIONS.map((item) => (
                        <button
                          type="button"
                          key={item.value}
                          className={currentRecipe.maDirection === item.value ? 'active' : ''}
                          aria-pressed={currentRecipe.maDirection === item.value}
                          onClick={() => updateDraftRecipe('maDirection', item.value)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cfr-radar-option-group">
                    <span>Timeframe</span>
                    <div className="cfr-radar-option-row">
                      {[
                        { value: '1d', label: 'Daily' },
                        { value: '1wk', label: 'Weekly' },
                      ].map((item) => (
                        <button
                          type="button"
                          key={item.value}
                          className={currentRecipe.maInterval === item.value ? 'active' : ''}
                          aria-pressed={currentRecipe.maInterval === item.value}
                          onClick={() => updateDraftRecipe('maInterval', item.value)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              </div>
              <div className="cfr-radar-schedule-picker">
                <div className="cfr-radar-schedule-heading">Choose up to 2 scan times · Jerusalem time</div>
                <div className="cfr-radar-schedule-grid">
                  <label>
                    <span>First scan</span>
                    <select
                      value={scheduleTime1}
                      onChange={(event) => setScheduleTime1(event.target.value)}
                      required
                      aria-label="First daily Radar scan time"
                    >
                      <option value="">Choose a time</option>
                      {RADAR_TIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      Second scan <em>optional</em>
                    </span>
                    <select
                      value={scheduleTime2}
                      onChange={(event) => setScheduleTime2(event.target.value)}
                      aria-label="Second daily Radar scan time"
                    >
                      <option value="">No second scan</option>
                      {RADAR_TIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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
                  Pick a time between 11:00 AM and 11:00 PM. Pre-market and regular-session checks are supported;
                  closed-market periods are skipped, and the expiry date is inclusive.
                </p>
              </div>
              <label className="cfr-radar-name-field">
                <span>
                  Radar name <em>optional</em>
                </span>
                <input
                  type="text"
                  maxLength={60}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Large-cap momentum"
                  aria-label="Radar name"
                />
              </label>
              <div className="cfr-radar-current-recipe">
                {modeLabel(currentRecipe)} <span>·</span> {Number(currentRecipe.minVolumeRatio || 0).toFixed(1)}x RVOL{' '}
                <span>·</span> {formatCap(currentRecipe.minMarketCap)} <span>·</span> SMA{currentRecipe.maPeriod}{' '}
                ±{currentRecipe.maDistance}%
              </div>
              {currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length === 0 && (
                <div className="cfr-radar-form-error">Choose at least one sector before activating this Radar.</div>
              )}
              <div className="cfr-radar-setup-actions">
                <button
                  type="button"
                  className="cfr-radar-cta"
                  onClick={activateRadar}
                  disabled={loading || (currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length === 0)}
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
