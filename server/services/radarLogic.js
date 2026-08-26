// Pure Capital Flow Radar rules.
//
// This module deliberately has no database, network, or notification
// dependency. Keeping the matching and transition rules pure makes them
// deterministic, testable, and easy to audit: a Radar event can only be
// produced from a real scan row that satisfies the saved recipe.

const REARM_AFTER_MISSED_SCANS = 2;
const MA_PERIODS = Object.freeze([9, 20, 50, 150]);
const MA_DISTANCES = Object.freeze([1, 2]);
const MA_INTERVALS = Object.freeze(['1d', '1wk']);
const MA_DIRECTIONS = Object.freeze(['all', 'above', 'below']);

function parseVolumeInput(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value).trim().toUpperCase();
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/.exec(text);
  if (!match) return null;
  const multiplier = match[2] === 'B' ? 1e9 : match[2] === 'M' ? 1e6 : match[2] === 'K' ? 1e3 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asFinite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function symbolOf(row) {
  const symbol = String(row && row.symbol ? row.symbol : '')
    .trim()
    .toUpperCase();
  return symbol || null;
}

function maMatchesRadar(row, radar) {
  const maValue = asFinite(row && row.maValue);
  const maDistance = asFinite(row && row.maDistance);
  const maPeriod = asFinite(row && row.maPeriod);
  const maInterval = String(row && row.maInterval ? row.maInterval : '');
  if (
    maValue == null ||
    maValue <= 0 ||
    maDistance == null ||
    maPeriod == null ||
    maPeriod !== Number(radar.maPeriod) ||
    maInterval !== String(radar.maInterval || '1d')
  )
    return false;

  const direction = String(radar && radar.maDirection ? radar.maDirection : 'all');
  if (direction === 'above' && maDistance < 0) return false;
  if (direction === 'below' && maDistance >= 0) return false;
  return Math.abs(maDistance) <= Number(radar.maDistance);
}

/**
 * Does one fully-enriched scanner row satisfy a saved Radar recipe?
 * Missing numeric data is a non-match, never a zero. That distinction is
 * important: an unavailable quote must not become a fabricated signal.
 */
function resultMatchesRadar(row, radar, universe) {
  const symbol = symbolOf(row);
  if (!symbol || !radar) return false;

  const volumeRatio = asFinite(row.volumeRatio);
  const marketCap = asFinite(row.marketCap);
  const volume = asFinite(row.volume);
  const price = asFinite(row.price);
  if (volumeRatio == null || marketCap == null || volume == null || price == null) return false;
  if (volumeRatio < Number(radar.minVolumeRatio)) return false;
  if (marketCap < Number(radar.minMarketCap)) return false;
  if (Number(radar.minVolume) > 0 && volume < Number(radar.minVolume)) return false;
  if (Number(radar.minPrice) > 0 && price < Number(radar.minPrice)) return false;
  if (Number(radar.maxPrice) > 0 && price > Number(radar.maxPrice)) return false;

  if (radar.mode === 'sp500' && universe && universe.sp500 && !universe.sp500.has(symbol)) return false;
  if (radar.mode === 'nasdaq100' && universe && universe.nasdaq100 && !universe.nasdaq100.has(symbol)) return false;
  if (radar.mode === 'sectors' && Array.isArray(radar.selectedSectors) && radar.selectedSectors.length > 0) {
    const sector = String(row.sector || '').trim();
    if (!radar.selectedSectors.includes(sector)) return false;
  }

  return maMatchesRadar(row, radar);
}

function normalizeState(state) {
  return {
    matches: !!(state && (state.matches === true || Number(state.matches) === 1)),
    enteredAt: state && state.enteredAt ? state.enteredAt : null,
    lastSeenAt: state && state.lastSeenAt ? state.lastSeenAt : null,
    missedChecks: Math.max(0, Number(state && state.missedChecks) || 0),
  };
}

/**
 * Compare one completed scan with the previous persisted state.
 *
 * An event is emitted only on a false -> true transition. A scan that did
 * not return usable results is explicitly unavailable and leaves every
 * previous state untouched. Symbols whose quote provider reported an error
 * are also not re-armed as exits, so a temporary provider gap cannot create
 * a false re-entry alert later.
 */
function evaluateRadarTransitions(radar, results, states, options) {
  const opts = options || {};
  const scanDate = new Date(opts.scanTime);
  if (
    !Array.isArray(results) ||
    !opts.scanTime ||
    Number.isNaN(scanDate.getTime()) ||
    opts.dataStatus === 'unavailable'
  ) {
    return {
      available: false,
      partial: false,
      scanTime: null,
      events: [],
      nextStates: states instanceof Map ? new Map(states) : new Map(),
    };
  }

  const sourceStates = states instanceof Map ? states : new Map();
  const nextStates = new Map();
  sourceStates.forEach((state, symbol) => nextStates.set(symbol, normalizeState(state)));

  const unavailable = new Set(
    Array.isArray(opts.unavailableSymbols)
      ? opts.unavailableSymbols
          .map((value) =>
            String(value || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      : []
  );
  const checked = new Set(
    (Array.isArray(opts.checkedSymbols) ? opts.checkedSymbols : [])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const currentMatches = new Map();
  const eventTime = scanDate.toISOString();

  results.forEach((row) => {
    const symbol = symbolOf(row);
    if (!symbol || !resultMatchesRadar(row, radar, opts.universe)) return;
    currentMatches.set(symbol, row);
  });

  const events = [];
  currentMatches.forEach((row, symbol) => {
    const previous = normalizeState(sourceStates.get(symbol));
    const entered = !previous.matches;
    nextStates.set(symbol, {
      matches: true,
      enteredAt: entered ? eventTime : previous.enteredAt || eventTime,
      lastSeenAt: eventTime,
      missedChecks: 0,
    });
    if (entered) {
      events.push({
        symbol,
        row,
        scanTime: eventTime,
        reentry: !!sourceStates.get(symbol),
      });
    }
  });

  sourceStates.forEach((rawState, symbol) => {
    // On a partial provider response, only symbols explicitly checked by all
    // required inputs may be re-armed. Missing symbols must remain untouched;
    // otherwise a temporary gap would create a false exit followed by a false
    // re-entry when the provider recovers.
    if (currentMatches.has(symbol) || unavailable.has(symbol) || (opts.dataStatus === 'partial' && !checked.has(symbol)))
      return;
    const state = normalizeState(rawState);
    if (!state.matches) return;
    const missedChecks = state.missedChecks + 1;
    nextStates.set(symbol, {
      ...state,
      matches: missedChecks < REARM_AFTER_MISSED_SCANS,
      missedChecks,
    });
  });

  return {
    available: true,
    partial: unavailable.size > 0,
    scanTime: eventTime,
    events,
    nextStates,
  };
}

module.exports = {
  REARM_AFTER_MISSED_SCANS,
  MA_PERIODS,
  MA_DISTANCES,
  MA_INTERVALS,
  MA_DIRECTIONS,
  parseVolumeInput,
  maMatchesRadar,
  resultMatchesRadar,
  evaluateRadarTransitions,
};
