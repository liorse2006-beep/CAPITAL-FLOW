import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import useModalA11y from '../../hooks/useModalA11y';

const DATA_UNAVAILABLE = 'Data is not available right now. Try again in a few minutes.';
const RADAR_SINGLE_LIMIT_MESSAGE =
  'Only one Radar scan can be saved per account. Edit or remove the current Radar before creating another.';

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

function conditionModeLabel(value) {
  return value === 'either' ? 'Either condition' : 'Both conditions';
}

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

function formatRadarDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[2]}/${match[3]}/${match[1]}` : 'Choose a date';
}

function formatBillions(value) {
  const billions = Number(value || 0) / 1e9;
  if (!Number.isFinite(billions) || billions <= 0) return '—';
  return Number.isInteger(billions) ? String(billions) : billions.toFixed(1);
}

function setupUniverseLabel(recipe) {
  if (recipe?.mode === 'sp500') return 'S&P 500';
  if (recipe?.mode === 'nasdaq100') return 'NASDAQ 100';
  if (recipe?.mode === 'sectors') return 'Selected sectors';
  return 'All stocks';
}

function dataLine(radar) {
  if (radar.dataStatus === 'unavailable') return radar.statusMessage || DATA_UNAVAILABLE;
  if (radar.dataStatus === 'partial')
    return radar.statusMessage || 'Some market data is unavailable right now. Try again in a few minutes.';
  if (radar.dataStatus === 'waiting') return 'WAITING FOR A SIGNAL';
  if (radar.dataStatus === 'needs_schedule' || radar.dataStatus === 'expired')
    return radar.statusMessage || 'Choose a new Radar schedule.';
  return null;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatRadarPriceValue(value) {
  const number = numberOrNull(value);
  return number === null ? '—' : '$' + number.toFixed(2);
}

function formatRadarChangeValue(value) {
  const number = numberOrNull(value);
  return number === null ? '—' : (number >= 0 ? '+' : '') + number.toFixed(2) + '%';
}

function formatRadarRatioValue(value) {
  const number = numberOrNull(value);
  return number === null ? '—' : number.toFixed(2) + 'x';
}

function radarConditionState(data, condition) {
  if (!Array.isArray(data?.matchedConditions)) return 'unknown';
  return data.matchedConditions.includes(condition) ? 'met' : 'not-met';
}

function capitalFlowDetail(data, radar) {
  const ratio = numberOrNull(data?.volumeRatio);
  const minimum = numberOrNull(radar?.minVolumeRatio);
  if (ratio === null || minimum === null) return 'RVOL data unavailable';
  return `RVOL ${ratio.toFixed(2)}x ${ratio >= minimum ? '≥' : '<'} ${minimum.toFixed(1)}x minimum`;
}

function movingAverageDetail(data, radar) {
  const period = numberOrNull(data?.maPeriod) ?? numberOrNull(radar?.maPeriod);
  const distance = numberOrNull(data?.maDistance);
  const limit = numberOrNull(radar?.maDistance);
  if (distance === null)
    return period === null ? 'Moving average distance unavailable' : `SMA${period} distance unavailable`;
  const position = distance > 0 ? 'above' : distance < 0 ? 'below' : 'at';
  const distanceText = Math.abs(distance).toFixed(2) + '%';
  const averageLabel = period === null ? 'moving average' : `SMA${period}`;
  return `Price ${distanceText} ${position} ${averageLabel}${limit === null ? '' : ` · limit ±${limit.toFixed(0)}%`}`;
}

function RadarConditionRow({ label, state, detail }) {
  return (
    <div className={'cfr-radar-signal-condition ' + state}>
      <span className="cfr-radar-signal-condition-icon" aria-hidden="true">
        {state === 'met' ? '✓' : state === 'not-met' ? '—' : '?'}
      </span>
      <span className="cfr-radar-signal-condition-label">{label}</span>
      <span className="cfr-radar-signal-condition-detail">{detail}</span>
    </div>
  );
}

function RadarSignalCard({ event, radar }) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const symbol = String(data.symbol || event?.symbol || '—').toUpperCase();
  const marketLine = [data.exchange, data.sector].filter(Boolean).join(' · ');
  const change = numberOrNull(data.change);
  const matchedConditions = Array.isArray(data.matchedConditions) ? data.matchedConditions : null;
  const capitalFlowState = radarConditionState(data, 'Capital Flow');
  const movingAverageState = radarConditionState(data, 'Moving Average');
  const maPeriod = numberOrNull(data.maPeriod) ?? numberOrNull(radar.maPeriod);

  return (
    <article className="cfr-radar-signal-card" aria-label={`${symbol} Radar entry`}>
      <div className="cfr-radar-signal-identity">
        <span className="cfr-radar-signal-symbol">{symbol}</span>
        <span className="cfr-radar-signal-match">
          <span aria-hidden="true">✓</span> MATCHED
        </span>
        {marketLine && <span className="cfr-radar-signal-market">{marketLine}</span>}
      </div>

      <div className="cfr-radar-signal-proof">
        <div className="cfr-radar-signal-proof-label">WHY RADAR SURFACED THIS</div>
        <div className="cfr-radar-signal-conditions">
          <RadarConditionRow label="Capital Flow" state={capitalFlowState} detail={capitalFlowDetail(data, radar)} />
          <RadarConditionRow
            label={maPeriod === null ? 'Moving Average' : `SMA${maPeriod}`}
            state={movingAverageState}
            detail={movingAverageDetail(data, radar)}
          />
        </div>
        {matchedConditions === null && (
          <div className="cfr-radar-signal-data-note">Match details unavailable for this entry.</div>
        )}
      </div>

      <div className="cfr-radar-signal-stats">
        <div className="cfr-radar-signal-stat">
          <span>PRICE</span>
          <b>{formatRadarPriceValue(data.price)}</b>
        </div>
        <div className="cfr-radar-signal-stat">
          <span>CHANGE %</span>
          <b className={change === null ? '' : change >= 0 ? 'positive' : 'negative'}>
            {formatRadarChangeValue(data.change)}
          </b>
        </div>
        <div className="cfr-radar-signal-stat">
          <span>RVOL</span>
          <b>{formatRadarRatioValue(data.volumeRatio)}</b>
        </div>
        <div className="cfr-radar-signal-stat cfr-radar-signal-stat-time">
          <span>SCANNED</span>
          <b>{formatTime(event?.scanTime || data.scanTime)}</b>
        </div>
      </div>

      <span className="cfr-radar-signal-arrow" aria-hidden="true">
        ›
      </span>
    </article>
  );
}

function RadarDeleteConfirm({ onCancel, onConfirm, removing, error }) {
  const panelRef = useModalA11y(onCancel);

  return createPortal(
    <div
      className="cfr-radar-confirm-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !removing) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="cfr-radar-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cfr-radar-remove-title"
        aria-describedby="cfr-radar-remove-description"
        tabIndex={-1}
      >
        <button
          type="button"
          className="cfr-radar-confirm-close"
          onClick={onCancel}
          aria-label="Close"
          disabled={removing}
        >
          ×
        </button>
        <span className="cfr-radar-confirm-kicker">CAPITAL FLOW / RADAR</span>
        <h2 id="cfr-radar-remove-title">Remove this Radar?</h2>
        <p id="cfr-radar-remove-description">
          This will stop the scan and remove its saved results. This action cannot be undone.
        </p>
        {error && (
          <div className="cfr-radar-confirm-error" role="alert">
            {error}
          </div>
        )}
        <div className="cfr-radar-confirm-actions">
          <button type="button" className="cfr-radar-confirm-cancel" onClick={onCancel} disabled={removing}>
            Keep Radar
          </button>
          <button type="button" className="cfr-radar-confirm-delete" onClick={onConfirm} disabled={removing}>
            {removing ? 'Removing…' : 'Remove Radar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
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
  const [radarsLoaded, setRadarsLoaded] = useState(false);
  const [radarLoadFailed, setRadarLoadFailed] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [editingRadarId, setEditingRadarId] = useState(null);
  const [name, setName] = useState('');
  const [scheduleTime1, setScheduleTime1] = useState('');
  const [scheduleTime2, setScheduleTime2] = useState('');
  const [expiresOn, setExpiresOn] = useState(todayIsrael());
  const [draftRecipe, setDraftRecipe] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingRemoveRadarId, setPendingRemoveRadarId] = useState(null);
  const [removingRadarId, setRemovingRadarId] = useState(null);

  const headers = useCallback(() => ({ Authorization: 'Bearer ' + (getToken ? getToken() : '') }), [getToken]);
  const radarAccess = !!user && (isElite || trialActive);

  const loadRadars = useCallback(() => {
    if (!radarAccess) {
      setRadars([]);
      setRadarsLoaded(true);
      setRadarLoadFailed(false);
      return Promise.resolve();
    }
    setRadarsLoaded(false);
    setRadarLoadFailed(false);
    setLoading(true);
    setError('');
    return fetch('/api/radars', { headers: headers() })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Radar data is temporarily unavailable.');
        return data;
      })
      .then((data) => {
        setRadars(Array.isArray(data.radars) ? data.radars : []);
        setRadarsLoaded(true);
      })
      .catch((err) => {
        setRadarLoadFailed(true);
        setRadarsLoaded(true);
        setError(err.message || DATA_UNAVAILABLE);
      })
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
      conditionMode: 'both',
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
      conditionMode: radar.conditionMode === 'either' ? 'either' : 'both',
    };
  }

  function closeSetup() {
    setSetupOpen(false);
    setAdvancedFiltersOpen(false);
    setEditingRadarId(null);
    setName('');
    setScheduleTime1('');
    setScheduleTime2('');
    setExpiresOn(todayIsrael());
    setDraftRecipe(null);
  }

  function openSetupForRadar(radar) {
    if (!radar && radars.length > 0) {
      setError(RADAR_SINGLE_LIMIT_MESSAGE);
      return;
    }
    setEditingRadarId(radar ? radar.id : null);
    setName(radar ? radar.name : '');
    setScheduleTime1(radar?.scheduleTime1 || '');
    setScheduleTime2(radar?.scheduleTime2 || '');
    setExpiresOn(radar?.expiresOn || todayIsrael());
    setDraftRecipe(radar ? radarRecipeFromRow(radar) : { ...recipe });
    setError('');
    setAdvancedFiltersOpen(false);
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
    const editing = editingRadarId !== null;
    if (!editing && radars.length > 0) {
      setError(RADAR_SINGLE_LIMIT_MESSAGE);
      return;
    }
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

  function requestRemoveRadar(id) {
    setError('');
    setPendingRemoveRadarId(id);
  }

  function cancelRemoveRadar() {
    if (removingRadarId !== null) return;
    setPendingRemoveRadarId(null);
    setError('');
  }

  function confirmRemoveRadar() {
    const id = pendingRemoveRadarId;
    if (id === null || removingRadarId !== null) return;
    setRemovingRadarId(id);
    setError('');
    fetch('/api/radars/' + id, { method: 'DELETE', headers: headers() })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Radar could not be removed right now.');
        return data;
      })
      .then(() => {
        setRadars((prev) => prev.filter((item) => item.id !== id));
        setPendingRemoveRadarId(null);
      })
      .catch((err) => setError(err.message || 'Radar could not be removed right now.'))
      .finally(() => setRemovingRadarId(null));
  }

  const locked = !radarAccess;
  const hasSavedRadar = radars.length > 0;
  const canCreateRadar = radarsLoaded && !radarLoadFailed && !hasSavedRadar && !loading;
  const hasActiveScheduledRadar = radars.some(
    (radar) => radar.active && radar.dataStatus !== 'expired' && radar.dataStatus !== 'needs_schedule'
  );
  const setupUniverse = setupUniverseLabel(currentRecipe);
  const setupConditionMode = currentRecipe.conditionMode === 'either' ? 'EITHER' : 'BOTH';
  const setupMinRatio = Number(currentRecipe.minVolumeRatio || 0).toFixed(1);
  const setupMinCap = formatBillions(currentRecipe.minMarketCap);
  const setupRecipe = `${setupUniverse} · RVOL ${setupMinRatio}x · SMA${currentRecipe.maPeriod} ±${currentRecipe.maDistance}% · ${
    currentRecipe.maInterval === '1wk' ? 'Weekly' : 'Daily'
  }`;
  const setupPriceRange =
    currentRecipe.minPrice || currentRecipe.maxPrice
      ? `${currentRecipe.minPrice ? '$' + currentRecipe.minPrice : 'Any'} – ${currentRecipe.maxPrice ? '$' + currentRecipe.maxPrice : 'Any'}`
      : null;

  return (
    <section
      className={'cfr-radar-panel' + (setupOpen && !locked ? ' cfr-radar-panel--setup-open' : '')}
      aria-labelledby={setupOpen && !locked ? 'capital-flow-radar-setup-title' : 'capital-flow-radar-title'}
    >
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
            <h3 id="capital-flow-radar-title">
              {hasSavedRadar && !setupOpen ? 'SIGNAL CARDS' : 'Catch the moment a setup appears.'}
            </h3>
            {hasSavedRadar && !setupOpen && (
              <span className="cfr-radar-results-heading">CAPITAL FLOW RADAR RESULTS</span>
            )}
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

                <div className="cfr-radar-results-toolbar">
                  <div className="cfr-radar-results-recipe">
                    <span>ACTIVE RADAR RECIPE</span>
                    <b>
                      {modeLabel(radar)} <em>·</em> RVOL {Number(radar.minVolumeRatio).toFixed(1)}x <em>·</em> SMA
                      {radar.maPeriod || 20} ±{Number(radar.maDistance || 2).toFixed(0)}% <em>·</em>{' '}
                      {radar.maInterval === '1wk' ? 'Weekly' : 'Daily'} <em>·</em>{' '}
                      {conditionModeLabel(radar.conditionMode)}
                    </b>
                  </div>
                  <div className="cfr-radar-results-last-check">
                    <span>LAST SCAN</span>
                    <b>{formatTime(radar.lastCheckAt)}</b>
                  </div>
                  <button
                    type="button"
                    className="cfr-radar-refresh cfr-radar-results-refresh"
                    onClick={() => setRefreshKey((key) => key + 1)}
                    disabled={loading}
                  >
                    <span className="cfr-radar-refresh-icon" aria-hidden="true">
                      ↻
                    </span>
                    {loading ? 'Checking…' : 'Refresh'}
                  </button>
                </div>

                <div className="cfr-radar-meta">
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
                    <div className="cfr-radar-signal-list">
                      {radar.events.slice(0, 3).map((event) => (
                        <RadarSignalCard key={event.id} event={event} radar={radar} />
                      ))}
                    </div>
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
                  <button type="button" onClick={() => requestRemoveRadar(radar.id)} className="danger">
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
              <div className="cfr-radar-setup-label" id="capital-flow-radar-setup-title">
                CAPITAL FLOW RADAR SETUP
                {editingRadarId !== null && <em> · EDITING SAVED RADAR</em>}
              </div>
              <div className="cfr-radar-condition-block">
                <fieldset className="cfr-radar-logic-picker">
                  <legend className="cfr-radar-logic-legend">
                    <span>ALERT LOGIC</span>
                  </legend>
                  <div className="cfr-radar-logic-options" role="radiogroup" aria-label="Radar alert logic">
                    <label
                      className={'cfr-radar-logic-option' + (currentRecipe.conditionMode === 'both' ? ' active' : '')}
                    >
                      <input
                        type="radio"
                        name="radar-condition-mode"
                        value="both"
                        checked={currentRecipe.conditionMode === 'both'}
                        onChange={() => updateDraftRecipe('conditionMode', 'both')}
                      />
                      <span className="cfr-radar-logic-option-copy">
                        <b>Both conditions</b>
                        <small>Capital Flow AND Moving Average must match.</small>
                      </span>
                    </label>
                    <label
                      className={'cfr-radar-logic-option' + (currentRecipe.conditionMode === 'either' ? ' active' : '')}
                    >
                      <input
                        type="radio"
                        name="radar-condition-mode"
                        value="either"
                        checked={currentRecipe.conditionMode === 'either'}
                        onChange={() => updateDraftRecipe('conditionMode', 'either')}
                      />
                      <span className="cfr-radar-logic-option-copy">
                        <b>Either condition</b>
                        <small>Capital Flow OR Moving Average is enough.</small>
                      </span>
                    </label>
                  </div>
                  <p className="cfr-radar-logic-result">
                    {currentRecipe.conditionMode === 'either'
                      ? 'One match sends an alert. If both match, you still receive one alert.'
                      : 'Only a match from both layers sends an alert.'}
                  </p>
                </fieldset>
                <div className="cfr-radar-filter-section">
                  <div className="cfr-radar-filter-section-heading">
                    <span>CAPITAL FLOW</span>
                    <small>Choose the universe and activity filters.</small>
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
                  </div>
                  <button
                    type="button"
                    className="cfr-radar-advanced-heading"
                    aria-expanded={advancedFiltersOpen}
                    aria-controls="cfr-radar-advanced-filters"
                    onClick={() => setAdvancedFiltersOpen((open) => !open)}
                  >
                    <span aria-hidden="true">{advancedFiltersOpen ? '⌃' : '⌄'}</span>
                    <span>
                      More filters <em>(optional)</em>
                    </span>
                  </button>
                  {advancedFiltersOpen && (
                    <div
                      id="cfr-radar-advanced-filters"
                      className="cfr-radar-filter-grid cfr-radar-advanced-filter-grid"
                    >
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
                  )}
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
                    <small>Set the SMA confirmation settings.</small>
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
              <aside className="cfr-radar-summary" aria-labelledby="cfr-radar-summary-title">
                <div className="cfr-radar-summary-head">
                  <span id="cfr-radar-summary-title">YOUR RADAR</span>
                  {editingRadarId !== null && <em>EDITING</em>}
                </div>
                <div className="cfr-radar-summary-recipe">{setupRecipe}</div>

                <div className="cfr-radar-summary-divider" />

                <div className="cfr-radar-summary-label">CONDITIONS ({setupConditionMode})</div>
                <div className="cfr-radar-summary-conditions">
                  <div className="cfr-radar-summary-condition">
                    <span className="cfr-radar-summary-step">1</span>
                    <div>
                      <b>CAPITAL FLOW CONDITION</b>
                      <p>Price action meets Capital Flow filters</p>
                      <ul>
                        <li>Universe: {setupUniverse}</li>
                        <li>Min RVOL: {setupMinRatio}</li>
                        <li>Min cap: ${setupMinCap}B</li>
                        {currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length > 0 && (
                          <li>Sectors: {currentRecipe.selectedSectors.join(' · ')}</li>
                        )}
                        {currentRecipe.minVolRaw && <li>Min volume: {currentRecipe.minVolRaw}</li>}
                        {setupPriceRange && <li>Price: {setupPriceRange}</li>}
                      </ul>
                    </div>
                  </div>
                  <div className="cfr-radar-summary-condition">
                    <span className="cfr-radar-summary-step">2</span>
                    <div>
                      <b>MOVING AVERAGE CONDITION</b>
                      <p>
                        Price is within ±{currentRecipe.maDistance}% of SMA{currentRecipe.maPeriod}
                      </p>
                      <ul>
                        <li>SMA period: {currentRecipe.maPeriod}</li>
                        <li>Distance: ±{currentRecipe.maDistance}%</li>
                        <li>
                          Direction:{' '}
                          {RADAR_MA_DIRECTIONS.find((item) => item.value === currentRecipe.maDirection)?.label || 'All'}
                        </li>
                        <li>Timeframe: {currentRecipe.maInterval === '1wk' ? 'Weekly' : 'Daily'}</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="cfr-radar-summary-divider" />

                <div className="cfr-radar-summary-schedule">
                  <div className="cfr-radar-summary-label">SCHEDULE</div>
                  <div className="cfr-radar-summary-schedule-row">
                    <span>First scan</span>
                    <b>{scheduleTime1 ? formatRadarTime(scheduleTime1) : 'Choose a time'}</b>
                  </div>
                  <div className="cfr-radar-summary-schedule-row">
                    <span>
                      Second scan <em>optional</em>
                    </span>
                    <b>{scheduleTime2 ? formatRadarTime(scheduleTime2) : 'No second scan'}</b>
                  </div>
                  <div className="cfr-radar-summary-schedule-row">
                    <span>Active through</span>
                    <b>{formatRadarDateInput(expiresOn)}</b>
                  </div>
                </div>

                {error && (
                  <div className="cfr-radar-error" role="alert">
                    {error}
                  </div>
                )}

                <div className="cfr-radar-summary-actions">
                  <button
                    type="button"
                    className="cfr-radar-cta cfr-radar-summary-cta"
                    onClick={activateRadar}
                    disabled={
                      loading || (currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length === 0)
                    }
                  >
                    Activate Radar <span aria-hidden="true">→</span>
                  </button>
                  <button type="button" className="cfr-radar-cancel" onClick={closeSetup}>
                    Cancel
                  </button>
                </div>
              </aside>
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
                <span>·</span> {formatCap(currentRecipe.minMarketCap)} <span>·</span> SMA{currentRecipe.maPeriod} ±
                {currentRecipe.maDistance}%
              </div>
              {currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length === 0 && (
                <div className="cfr-radar-form-error">Choose at least one sector before activating this Radar.</div>
              )}
            </div>
          ) : canCreateRadar ? (
            <button type="button" className="cfr-radar-activate" onClick={() => openSetupForRadar(null)}>
              <span className="cfr-radar-plus" aria-hidden="true">
                +
              </span>
              Activate this scan as Radar
            </button>
          ) : null}

          {!setupOpen && error && (
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
      {pendingRemoveRadarId !== null && (
        <RadarDeleteConfirm
          onCancel={cancelRemoveRadar}
          onConfirm={confirmRemoveRadar}
          removing={removingRadarId !== null}
          error={error}
        />
      )}
    </section>
  );
}
