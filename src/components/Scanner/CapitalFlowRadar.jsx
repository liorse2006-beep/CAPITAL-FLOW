import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import useModalA11y from '../../hooks/useModalA11y';
import { sectorName } from '../../utils/marketCopy';

const DATA_UNAVAILABLE = 'הנתונים אינם זמינים כרגע. אפשר לנסות שוב בעוד כמה דקות.';
const RADAR_SINGLE_LIMIT_MESSAGE = 'ניתן לשמור רדאר אחד בחשבון. לפני יצירת רדאר נוסף יש לערוך או להסיר את הקיים.';

function modeLabel(radar) {
  if (radar.mode === 'sp500') return 'S&P 500';
  if (radar.mode === 'nasdaq100') return 'NASDAQ 100';
  if (radar.mode === 'sectors') return radar.selectedSectors.map(sectorName).join(' · ');
  return 'כל השוק';
}

function formatCap(value) {
  const billions = Number(value || 0) / 1e9;
  return '$' + (billions >= 10 ? billions.toFixed(0) : billions.toFixed(1)) + 'B שווי שוק';
}

function formatRadarTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return value || '—';
  const hour = Number(match[1]);
  const minute = match[2];
  return `${String(hour).padStart(2, '0')}:${minute}`;
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
  { value: 'all', label: 'הכול' },
  { value: 'above', label: 'מעל' },
  { value: 'below', label: 'מתחת' },
];

function conditionModeLabel(value) {
  return value === 'either' ? 'אחד התנאים' : 'שני התנאים';
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
  return match ? `${match[2]}/${match[3]}/${match[1]}` : 'בחירת תאריך';
}

function formatBillions(value) {
  const billions = Number(value || 0) / 1e9;
  if (!Number.isFinite(billions) || billions <= 0) return '—';
  return Number.isInteger(billions) ? String(billions) : billions.toFixed(1);
}

function setupUniverseLabel(recipe) {
  if (recipe?.mode === 'sp500') return 'S&P 500';
  if (recipe?.mode === 'nasdaq100') return 'NASDAQ 100';
  if (recipe?.mode === 'sectors') return 'סקטורים נבחרים';
  return 'כל המניות';
}

function dataLine(radar) {
  if (radar.dataStatus === 'unavailable') return DATA_UNAVAILABLE;
  if (radar.dataStatus === 'partial') return 'חלק מנתוני השוק אינם זמינים. אפשר לבדוק שוב בהמשך.';
  if (radar.dataStatus === 'waiting') return 'ממתינים להתאמה';
  if (radar.dataStatus === 'needs_schedule' || radar.dataStatus === 'expired') return 'יש לבחור תזמון חדש לרדאר.';
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
  if (ratio === null || minimum === null) return 'יחס הנפח אינו זמין';
  return `RVOL ${ratio.toFixed(2)}x ${ratio >= minimum ? '≥' : '<'} ${minimum.toFixed(1)}x מינימלי`;
}

function movingAverageDetail(data, radar) {
  const period = numberOrNull(data?.maPeriod) ?? numberOrNull(radar?.maPeriod);
  const distance = numberOrNull(data?.maDistance);
  const limit = numberOrNull(radar?.maDistance);
  if (distance === null) return period === null ? 'המרחק מהממוצע הנע אינו זמין' : `המרחק מ־SMA${period} אינו זמין`;
  const position = distance > 0 ? 'מעל' : distance < 0 ? 'מתחת' : 'בגובה';
  const distanceText = Math.abs(distance).toFixed(2) + '%';
  const averageLabel = period === null ? 'הממוצע הנע' : `SMA${period}`;
  return `המחיר ${distanceText} ${position} ${averageLabel}${limit === null ? '' : ` · טווח ±${limit.toFixed(0)}%`}`;
}

function RadarConditionRow({ label, state, detail }) {
  return (
    <div className={'cfr-radar-signal-condition ' + state}>
      <span className="cfr-radar-signal-condition-icon" aria-hidden="true">
        {state === 'met' ? '✓' : state === 'not-met' ? '—' : '?'}
      </span>
      <span className="cfr-radar-signal-condition-label">{label === 'Moving Average' ? 'ממוצעים נעים' : label}</span>
      <span className="cfr-radar-signal-condition-detail">{detail}</span>
    </div>
  );
}

function RadarSignalCard({ event, radar }) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const symbol = String(data.symbol || event?.symbol || '—').toUpperCase();
  const marketLine = [data.exchange, data.sector ? sectorName(data.sector) : null].filter(Boolean).join(' · ');
  const change = numberOrNull(data.change);
  const matchedConditions = Array.isArray(data.matchedConditions) ? data.matchedConditions : null;
  const capitalFlowState = radarConditionState(data, 'Capital Flow');
  const movingAverageState = radarConditionState(data, 'Moving Average');
  const maPeriod = numberOrNull(data.maPeriod) ?? numberOrNull(radar.maPeriod);

  return (
    <article className="cfr-radar-signal-card" aria-label={`התאמת רדאר עבור ${symbol}`}>
      <div className="cfr-radar-signal-identity">
        <span className="cfr-radar-signal-symbol">{symbol}</span>
        <span className="cfr-radar-signal-match">
          <span aria-hidden="true">✓</span> נמצאה התאמה
        </span>
        {marketLine && <span className="cfr-radar-signal-market">{marketLine}</span>}
      </div>

      <div className="cfr-radar-signal-proof">
        <div className="cfr-radar-signal-proof-label">למה המניה מתאימה?</div>
        <div className="cfr-radar-signal-conditions">
          <RadarConditionRow label="Capital Flow" state={capitalFlowState} detail={capitalFlowDetail(data, radar)} />
          <RadarConditionRow
            label={maPeriod === null ? 'ממוצע נע' : `SMA${maPeriod}`}
            state={movingAverageState}
            detail={movingAverageDetail(data, radar)}
          />
        </div>
        {matchedConditions === null && (
          <div className="cfr-radar-signal-data-note">פרטי ההתאמה אינם זמינים לתוצאה זו.</div>
        )}
      </div>

      <div className="cfr-radar-signal-stats">
        <div className="cfr-radar-signal-stat">
          <span>מחיר</span>
          <b>{formatRadarPriceValue(data.price)}</b>
        </div>
        <div className="cfr-radar-signal-stat">
          <span>שינוי באחוזים</span>
          <b className={change === null ? '' : change >= 0 ? 'positive' : 'negative'}>
            {formatRadarChangeValue(data.change)}
          </b>
        </div>
        <div className="cfr-radar-signal-stat">
          <span>RVOL</span>
          <b>{formatRadarRatioValue(data.volumeRatio)}</b>
        </div>
        <div className="cfr-radar-signal-stat cfr-radar-signal-stat-time">
          <span>מועד סריקה</span>
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
          aria-label="סגירה"
          disabled={removing}
        >
          ×
        </button>
        <span className="cfr-radar-confirm-kicker">רדאר Capital Flow</span>
        <h2 id="cfr-radar-remove-title">להסיר את הרדאר הזה?</h2>
        <p id="cfr-radar-remove-description">הסריקה תיפסק והתוצאות השמורות יוסרו. לא ניתן לבטל את ההסרה.</p>
        {error && (
          <div className="cfr-radar-confirm-error" role="alert">
            {error}
          </div>
        )}
        <div className="cfr-radar-confirm-actions">
          <button type="button" className="cfr-radar-confirm-cancel" onClick={onCancel} disabled={removing}>
            שמירת הרדאר
          </button>
          <button type="button" className="cfr-radar-confirm-delete" onClick={onConfirm} disabled={removing}>
            {removing ? 'מסירים…' : 'הסרת רדאר'}
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
        if (!response.ok) throw new Error(data.error || 'נתוני הרדאר אינם זמינים כרגע.');
        return data;
      })
      .then((data) => {
        setRadars(Array.isArray(data.radars) ? data.radars : []);
        setRadarsLoaded(true);
      })
      .catch(() => {
        setRadarLoadFailed(true);
        setRadarsLoaded(true);
        setError(DATA_UNAVAILABLE);
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
    setError('');
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
      setError('יש לבחור לפחות שעת סריקה אחת.');
      return;
    }
    if (scheduleTime2 && scheduleTime1 === scheduleTime2) {
      setError('יש לבחור שתי שעות שונות.');
      return;
    }
    if (!expiresOn) {
      setError('יש לבחור תאריך סיום לרדאר.');
      return;
    }
    if (selectedRecipe.mode === 'sectors' && selectedRecipe.selectedSectors.length === 0) {
      setError('יש לבחור לפחות סקטור אחד לפני הפעלת הרדאר.');
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
        if (!response.ok) throw new Error('לא הצלחנו ליצור את הרדאר. אפשר לנסות שוב.');
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
      .catch(() =>
        setError(editing ? 'לא הצלחנו לעדכן את הרדאר. אפשר לנסות שוב.' : 'לא הצלחנו ליצור את הרדאר. אפשר לנסות שוב.')
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
        if (!response.ok) throw new Error('לא הצלחנו לעדכן את הרדאר. אפשר לנסות שוב.');
        return data;
      })
      .then((data) => {
        if (data.radar) setRadars((prev) => prev.map((item) => (item.id === id ? data.radar : item)));
      })
      .catch(() => setError('לא הצלחנו לעדכן את הרדאר. אפשר לנסות שוב.'));
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
        if (!response.ok) throw new Error('לא הצלחנו להסיר את הרדאר. אפשר לנסות שוב.');
        return data;
      })
      .then(() => {
        setRadars((prev) => prev.filter((item) => item.id !== id));
        setPendingRemoveRadarId(null);
      })
      .catch(() => setError('לא הצלחנו להסיר את הרדאר. אפשר לנסות שוב.'))
      .finally(() => setRemovingRadarId(null));
  }

  const locked = !radarAccess;
  const hasSavedRadar = radars.length > 0;
  const canCreateRadar = radarsLoaded && !radarLoadFailed && !hasSavedRadar && !loading;
  const hasActiveScheduledRadar = radars.some(
    (radar) => radar.active && radar.dataStatus !== 'expired' && radar.dataStatus !== 'needs_schedule'
  );
  const setupUniverse = setupUniverseLabel(currentRecipe);
  const setupConditionMode = currentRecipe.conditionMode === 'either' ? 'אחד התנאים' : 'שני התנאים';
  const setupMinRatio = Number(currentRecipe.minVolumeRatio || 0).toFixed(1);
  const setupMinCap = formatBillions(currentRecipe.minMarketCap);
  const setupRecipe = `${setupUniverse} · RVOL ${setupMinRatio}x · SMA${currentRecipe.maPeriod} ±${currentRecipe.maDistance}% · ${
    currentRecipe.maInterval === '1wk' ? 'שבועי' : 'יומי'
  }`;
  const setupPriceRange =
    currentRecipe.minPrice || currentRecipe.maxPrice
      ? `${currentRecipe.minPrice ? '$' + currentRecipe.minPrice : 'ללא הגבלה'} – ${currentRecipe.maxPrice ? '$' + currentRecipe.maxPrice : 'ללא הגבלה'}`
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
            <span className="cfr-radar-kicker">רדאר Capital Flow</span>
            <h3 id="capital-flow-radar-title">{hasSavedRadar && !setupOpen ? 'תוצאות הרדאר' : 'רדאר Capital Flow'}</h3>
            {hasSavedRadar && !setupOpen && <span className="cfr-radar-results-heading">תוצאות רדאר Capital Flow</span>}
          </div>
        </div>
        <span className={'cfr-radar-state' + (locked ? ' locked' : hasActiveScheduledRadar ? ' on' : '')}>
          {locked
            ? !user
              ? 'התחבר כדי להפעיל'
              : 'כלול במסלול Elite'
            : hasActiveScheduledRadar
              ? 'מתוזמן'
              : 'מוכן לתזמון'}
        </span>
      </div>

      {locked ? (
        <div className="cfr-radar-locked">
          <span>
            {user
              ? 'הרדאר זמין בתקופת הניסיון ובמסלול Elite. הוא אינו כלול ב־Premium.'
              : 'התחבר כדי להפעיל רדאר ולסרוק גם כשאינך באפליקציה.'}
          </span>
          <button className="cfr-radar-cta" type="button" onClick={user ? onUpgrade : onSignIn}>
            {user ? 'שדרוג ל־Elite' : 'התחברות להפעלה'} <span aria-hidden="true">→</span>
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
                      ? 'נתונים זמינים'
                      : radar.dataStatus === 'partial'
                        ? 'נתונים חלקיים'
                        : radar.dataStatus === 'waiting'
                          ? 'ממתינים'
                          : 'אין נתונים זמינים'}
                  </span>
                </div>

                <div className="cfr-radar-results-toolbar">
                  <div className="cfr-radar-results-recipe">
                    <span>הגדרות הרדאר הפעיל</span>
                    <b>
                      {modeLabel(radar)} <em>·</em> RVOL {Number(radar.minVolumeRatio).toFixed(1)}x <em>·</em> SMA
                      {radar.maPeriod || 20} ±{Number(radar.maDistance || 2).toFixed(0)}% <em>·</em>{' '}
                      {radar.maInterval === '1wk' ? 'שבועי' : 'יומי'} <em>·</em>{' '}
                      {conditionModeLabel(radar.conditionMode)}
                    </b>
                  </div>
                  <div className="cfr-radar-results-last-check">
                    <span>סריקה אחרונה</span>
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
                    {loading ? 'בודקים…' : 'עדכון'}
                  </button>
                </div>

                <div className="cfr-radar-meta">
                  <span>
                    שעות סריקה{' '}
                    <b>
                      {[radar.scheduleTime1, radar.scheduleTime2].filter(Boolean).map(formatRadarTime).join(' · ') ||
                        'לא הוגדר'}
                    </b>
                  </span>
                  <span>
                    עד <b>{formatDate(radar.expiresOn)}</b>
                  </span>
                </div>

                {unavailableMessage && (
                  <div className={'cfr-radar-data-note ' + radar.dataStatus} role="status">
                    <span aria-hidden="true">!</span> {unavailableMessage}
                  </div>
                )}

                {radar.events && radar.events.length > 0 && (
                  <div className="cfr-radar-events">
                    <div className="cfr-radar-events-label">התאמות אחרונות</div>
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
                      ? 'הגדרת תזמון'
                      : 'עריכת תזמון'}
                  </button>
                  <button type="button" onClick={() => updateRadar(radar.id, { active: !radar.active })}>
                    {radar.active ? 'השהיה' : 'הפעלה מחדש'}
                  </button>
                  <button type="button" onClick={() => requestRemoveRadar(radar.id)} className="danger">
                    הסרה
                  </button>
                </div>
              </article>
            );
          })}

          {latestEvent && (
            <div className="cfr-radar-live-event" role="status" aria-live="polite">
              <span className="cfr-radar-live-pulse" />
              <span>
                <b>{latestEvent.symbol}</b> התאימה לרדאר שמור
              </span>
            </div>
          )}

          {setupOpen ? (
            <div className="cfr-radar-setup">
              <div className="cfr-radar-setup-label" id="capital-flow-radar-setup-title">
                הגדרת רדאר Capital Flow
                {editingRadarId !== null && <em> · עריכת רדאר שמור</em>}
              </div>
              <div className="cfr-radar-condition-block">
                <fieldset className="cfr-radar-logic-picker">
                  <legend className="cfr-radar-logic-legend">
                    <span>תנאי ההתראה</span>
                  </legend>
                  <div className="cfr-radar-logic-options" role="radiogroup" aria-label="תנאי ההתראה ברדאר">
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
                        <b>שני התנאים</b>
                        <small>גם נפח המסחר וגם הממוצע הנע צריכים להתאים.</small>
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
                        <b>אחד התנאים</b>
                        <small>מספיק שנפח המסחר או הממוצע הנע יתאימו.</small>
                      </span>
                    </label>
                  </div>
                  <p className="cfr-radar-logic-result">
                    {currentRecipe.conditionMode === 'either'
                      ? 'התאמה אחת מספיקה להתראה. גם אם שני התנאים מתקיימים, נשלחת התראה אחת.'
                      : 'התראה נשלחת רק אם שני התנאים מתקיימים.'}
                  </p>
                </fieldset>
                <div className="cfr-radar-filter-section">
                  <div className="cfr-radar-filter-section-heading">
                    <span>CAPITAL FLOW</span>
                    <small>בחר את המניות והמסננים לסריקה.</small>
                  </div>
                  <div className="cfr-radar-filter-grid">
                    <label className="cfr-radar-filter cfr-radar-filter-wide">
                      <span>קבוצת מניות</span>
                      <select
                        value={currentRecipe.mode}
                        onChange={(event) =>
                          updateDraftRecipe('mode', event.target.value === 'sectors' ? 'sectors' : event.target.value)
                        }
                        aria-label="קבוצת מניות ברדאר"
                      >
                        <option value="all">כל המניות</option>
                        <option value="sp500">S&amp;P 500</option>
                        <option value="nasdaq100">NASDAQ 100</option>
                        <option value="sectors">סקטורים נבחרים</option>
                      </select>
                    </label>
                    <label className="cfr-radar-filter">
                      <span>יחס נפח מינימלי</span>
                      <input
                        type="number"
                        min="1.5"
                        max="100"
                        step="0.1"
                        value={currentRecipe.minVolumeRatio}
                        onChange={(event) => updateDraftRecipe('minVolumeRatio', event.target.value)}
                        aria-label="יחס נפח מינימלי"
                      />
                    </label>
                    <label className="cfr-radar-filter">
                      <span>שווי מינימלי במיליארדי דולר</span>
                      <input
                        type="number"
                        min="0.5"
                        max="100000"
                        step="0.1"
                        value={(Number(currentRecipe.minMarketCap || 0) / 1e9).toString()}
                        onChange={(event) => updateDraftRecipe('minMarketCap', Number(event.target.value) * 1e9)}
                        aria-label="שווי שוק מינימלי במיליארדי דולר"
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
                      מסננים נוספים <em>(לא חובה)</em>
                    </span>
                  </button>
                  {advancedFiltersOpen && (
                    <div
                      id="cfr-radar-advanced-filters"
                      className="cfr-radar-filter-grid cfr-radar-advanced-filter-grid"
                    >
                      <label className="cfr-radar-filter">
                        <span>נפח מינימלי</span>
                        <input
                          type="text"
                          value={currentRecipe.minVolRaw}
                          onChange={(event) => updateDraftRecipe('minVolRaw', event.target.value.toUpperCase())}
                          placeholder="לא חובה"
                          aria-label="נפח מסחר מינימלי"
                        />
                      </label>
                      <label className="cfr-radar-filter">
                        <span>מחיר מינימלי</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={currentRecipe.minPrice || ''}
                          onChange={(event) => updateDraftRecipe('minPrice', Number(event.target.value || 0))}
                          placeholder="לא חובה"
                          aria-label="מחיר מינימלי"
                        />
                      </label>
                      <label className="cfr-radar-filter">
                        <span>מחיר מקסימלי</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={currentRecipe.maxPrice || ''}
                          onChange={(event) => updateDraftRecipe('maxPrice', Number(event.target.value || 0))}
                          placeholder="לא חובה"
                          aria-label="מחיר מקסימלי"
                        />
                      </label>
                    </div>
                  )}
                  {currentRecipe.mode === 'sectors' && (
                    <div className="cfr-radar-sector-picker">
                      <span>סקטורים</span>
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
                    <span>ממוצע נע</span>
                    <small>הגדר את תנאי ההתאמה לממוצע הנע.</small>
                  </div>
                  <div className="cfr-radar-ma-controls">
                    <div className="cfr-radar-option-group">
                      <span>תקופת הממוצע הנע</span>
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
                      <span>מרחק</span>
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
                      <span>כיוון</span>
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
                      <span>טווח זמן</span>
                      <div className="cfr-radar-option-row">
                        {[
                          { value: '1d', label: 'יומי' },
                          { value: '1wk', label: 'שבועי' },
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
                  <span id="cfr-radar-summary-title">הרדאר שלך</span>
                  {editingRadarId !== null && <em>עריכה</em>}
                </div>
                <div className="cfr-radar-summary-recipe">{setupRecipe}</div>

                <div className="cfr-radar-summary-divider" />

                <div className="cfr-radar-summary-label">תנאים ({setupConditionMode})</div>
                <div className="cfr-radar-summary-conditions">
                  <div className="cfr-radar-summary-condition">
                    <span className="cfr-radar-summary-step">1</span>
                    <div>
                      <b>תנאי נפח מסחר</b>
                      <p>המניה עומדת במסנני נפח המסחר</p>
                      <ul>
                        <li>קבוצת מניות: {setupUniverse}</li>
                        <li>יחס נפח מינימלי: {setupMinRatio}</li>
                        <li>
                          שווי שוק מינימלי: <bdi dir="ltr">${setupMinCap}B</bdi>
                        </li>
                        {currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length > 0 && (
                          <li>סקטורים: {currentRecipe.selectedSectors.map(sectorName).join(' · ')}</li>
                        )}
                        {currentRecipe.minVolRaw && <li>נפח מינימלי: {currentRecipe.minVolRaw}</li>}
                        {setupPriceRange && (
                          <li>
                            מחיר: <bdi dir="ltr">{setupPriceRange}</bdi>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                  <div className="cfr-radar-summary-condition">
                    <span className="cfr-radar-summary-step">2</span>
                    <div>
                      <b>תנאי ממוצע נע</b>
                      <p>
                        המחיר נמצא בטווח ±{currentRecipe.maDistance}% מהממוצע הנע SMA{currentRecipe.maPeriod}
                      </p>
                      <ul>
                        <li>תקופת הממוצע הנע: {currentRecipe.maPeriod}</li>
                        <li>מרחק: ±{currentRecipe.maDistance}%</li>
                        <li>
                          כיוון:{' '}
                          {RADAR_MA_DIRECTIONS.find((item) => item.value === currentRecipe.maDirection)?.label ||
                            'הכול'}
                        </li>
                        <li>טווח זמן: {currentRecipe.maInterval === '1wk' ? 'שבועי' : 'יומי'}</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="cfr-radar-summary-divider" />

                <div className="cfr-radar-summary-schedule">
                  <div className="cfr-radar-summary-label">תזמון</div>
                  <div className="cfr-radar-summary-schedule-row">
                    <span>סריקה ראשונה</span>
                    <b>{scheduleTime1 ? formatRadarTime(scheduleTime1) : 'בחירת שעה'}</b>
                  </div>
                  <div className="cfr-radar-summary-schedule-row">
                    <span>
                      סריקה שנייה <em>לא חובה</em>
                    </span>
                    <b>{scheduleTime2 ? formatRadarTime(scheduleTime2) : 'ללא סריקה שנייה'}</b>
                  </div>
                  <div className="cfr-radar-summary-schedule-row">
                    <span>פעיל עד</span>
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
                    הפעלת רדאר <span aria-hidden="true">→</span>
                  </button>
                  <button type="button" className="cfr-radar-cancel" onClick={closeSetup}>
                    ביטול
                  </button>
                </div>
              </aside>
              <div className="cfr-radar-schedule-picker">
                <div className="cfr-radar-schedule-heading">בחר עד שתי שעות סריקה · שעון ירושלים</div>
                <div className="cfr-radar-schedule-grid">
                  <label>
                    <span>סריקה ראשונה</span>
                    <select
                      value={scheduleTime1}
                      onChange={(event) => setScheduleTime1(event.target.value)}
                      required
                      aria-label="שעת הסריקה הראשונה"
                    >
                      <option value="">בחירת שעה</option>
                      {RADAR_TIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      סריקה שנייה <em>לא חובה</em>
                    </span>
                    <select
                      value={scheduleTime2}
                      onChange={(event) => setScheduleTime2(event.target.value)}
                      aria-label="שעת הסריקה השנייה"
                    >
                      <option value="">ללא סריקה שנייה</option>
                      {RADAR_TIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cfr-radar-expiry-field">
                    <span>פעיל עד</span>
                    <input
                      type="date"
                      value={expiresOn}
                      min={todayIsrael()}
                      onChange={(event) => setExpiresOn(event.target.value)}
                      required
                      aria-label="תאריך סיום לרדאר"
                    />
                  </label>
                </div>
                <p className="cfr-radar-schedule-note">
                  בחר שעה בין 11:00 ל־23:00. הסריקות פועלות במסחר המוקדם ובמסחר הרגיל; כשהמסחר סגור הסריקה לא מתבצעת.
                  תאריך הסיום כלול.
                </p>
              </div>
              <label className="cfr-radar-name-field">
                <span>
                  שם הרדאר <em>לא חובה</em>
                </span>
                <input
                  type="text"
                  maxLength={60}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="לדוגמה: פעילות במניות גדולות"
                  aria-label="שם הרדאר"
                />
              </label>
              <div className="cfr-radar-current-recipe">
                {modeLabel(currentRecipe)} <span>·</span> {Number(currentRecipe.minVolumeRatio || 0).toFixed(1)}x RVOL{' '}
                <span>·</span> {formatCap(currentRecipe.minMarketCap)} <span>·</span> SMA{currentRecipe.maPeriod} ±
                {currentRecipe.maDistance}%
              </div>
              {currentRecipe.mode === 'sectors' && currentRecipe.selectedSectors.length === 0 && (
                <div className="cfr-radar-form-error">יש לבחור לפחות סקטור אחד לפני הפעלת הרדאר.</div>
              )}
            </div>
          ) : canCreateRadar ? (
            <button type="button" className="cfr-radar-activate" onClick={() => openSetupForRadar(null)}>
              <span className="cfr-radar-plus" aria-hidden="true">
                +
              </span>
              הפעלת הסריקה כרדאר
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
            {loading ? 'בודקים…' : 'עדכון מצב הרדאר'}
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
