// Capital Flow Radar persistence and event dispatch.
//
// The Radar consumes one shared Capital Flow scan for each selected schedule
// window. It does not start a private scan per user, which keeps provider/API
// usage bounded as the user base grows. The database stores both the recipe and each
// symbol's last known state so a process restart cannot turn one ongoing
// signal into a stream of duplicate notifications.

const db = require('../db');
const { SP500, NASDAQ100, SECTOR_TICKERS } = require('../../tickers');
const { ADMIN_EMAIL } = require('../config');
const { freeTrialActive } = require('./scanQuota');
const { reportError } = require('../utils/reportError');
const {
  MA_PERIODS,
  MA_DISTANCES,
  MA_INTERVALS,
  MA_DIRECTIONS,
  CONDITION_MODES,
  parseVolumeInput,
  evaluateRadarTransitions,
} = require('./radarLogic');

const RADAR_TIMEZONE = 'Asia/Jerusalem';
const MAX_RADAR_SCANS_PER_DAY = 2;
const MIN_VOLUME_RATIO = 1.5;
const MIN_MARKET_CAP = 500_000_000;
const MAX_MARKET_CAP = 100_000_000_000_000;
// A customer can keep one Radar recipe only. That recipe is also the only
// recipe that can be active, which keeps the product promise and the worker's
// per-user monitoring state unambiguous.
const MAX_RADARS_PER_USER = 1;
const MAX_ACTIVE_RADARS_PER_USER = 1;
const MAX_EVENTS_PER_RADAR = 50;
const DATA_UNAVAILABLE_MESSAGE = 'Data is not available right now. Try again in a few minutes.';
const PARTIAL_DATA_MESSAGE = 'Some market data is unavailable right now. Try again in a few minutes.';
const RADAR_SCHEDULE_MESSAGE = 'Choose one or two scan times and an expiry date before activating this Radar.';
const RADAR_LIMIT_MESSAGE =
  'Only one Radar scan can be saved per account. Edit or remove the current Radar before creating another.';
const RADAR_ACTIVE_LIMIT_MESSAGE =
  'Only one Radar scan can be active at a time. Edit or remove the current Radar before activating another.';
const RADAR_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RADAR_SLOT_START = 11 * 60;
const RADAR_SLOT_END = 23 * 60;
const CONDITION_VERSION = 'radar-v2';

const UNIVERSE = {
  sp500: new Set(SP500),
  nasdaq100: new Set(NASDAQ100),
};

function cleanName(value) {
  const safeText = Array.from(String(value == null ? '' : value))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  const name = safeText.replace(/\s+/g, ' ').trim();
  return (name || 'Capital Flow Radar').slice(0, 60);
}

function radarLimitError(message = RADAR_LIMIT_MESSAGE, code = 'RADAR_LIMIT_REACHED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isActiveRadarUniqueError(error) {
  const message = String(error && error.message ? error.message : '');
  const code = String(error && error.code ? error.code : '');
  return (
    message.includes('idx_capital_flow_radars_one_active_user') ||
    (message.includes('capital_flow_radars.user_id') && code.includes('CONSTRAINT'))
  );
}

function parseSectors(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function zonedToday(timeZone = RADAR_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}`;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function scheduleValue(input, camel, snake) {
  return input[camel] ?? input[snake] ?? null;
}

function numberOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function allowedRadarTime(value) {
  if (typeof value !== 'string' || !RADAR_TIME_RE.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  const total = hour * 60 + minute;
  return total >= RADAR_SLOT_START && total <= RADAR_SLOT_END && minute % 30 === 0;
}

function integerOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Normalize and validate both HTTP input and existing DB rows. */
function normalizeRadarInput(input, base, options = {}) {
  const source = { ...(base || {}), ...(input || {}) };
  const requireSchedule = options.requireSchedule !== false;
  const mode = String(source.mode || 'all');
  if (!['all', 'sp500', 'nasdaq100', 'sectors'].includes(mode)) {
    const error = new Error('Invalid Radar universe');
    error.code = 'INVALID_RADAR';
    throw error;
  }

  const selectedSectors = parseSectors(source.selectedSectors ?? source.selected_sectors);
  if (
    selectedSectors.length > 12 ||
    selectedSectors.some((sector) => !Object.prototype.hasOwnProperty.call(SECTOR_TICKERS, sector))
  ) {
    const error = new Error('Invalid Radar sectors');
    error.code = 'INVALID_RADAR';
    throw error;
  }
  if (mode === 'sectors' && selectedSectors.length === 0) {
    const error = new Error('Select at least one sector or use Full Scan');
    error.code = 'INVALID_RADAR';
    throw error;
  }

  const minVolumeRatio = numberOr(source.minVolumeRatio ?? source.min_volume_ratio, MIN_VOLUME_RATIO);
  const minMarketCap = numberOr(source.minMarketCap ?? source.min_market_cap, MIN_MARKET_CAP);
  const minPrice = numberOr(source.minPrice ?? source.min_price, 0);
  const maxPrice = numberOr(source.maxPrice ?? source.max_price, 0);
  const minVolume = parseVolumeInput(source.minVolRaw ?? source.minVolume ?? source.min_volume ?? '');
  const maPeriod = integerOr(source.maPeriod ?? source.ma_period, 20);
  const maDistance = numberOr(source.maDistance ?? source.ma_distance, 2);
  const maInterval = String(source.maInterval ?? source.ma_interval ?? '1d');
  const maDirection = String(source.maDirection ?? source.ma_direction ?? 'all');
  const conditionMode = String(source.conditionMode ?? source.condition_mode ?? 'both').toLowerCase();
  if (!CONDITION_MODES.includes(conditionMode)) {
    const error = new Error('Choose whether one or both Radar conditions can trigger an alert.');
    error.code = 'INVALID_RADAR_FILTERS';
    throw error;
  }

  const scheduleTime1 = scheduleValue(source, 'scheduleTime1', 'schedule_time_1');
  const scheduleTime2 = scheduleValue(source, 'scheduleTime2', 'schedule_time_2');
  const expiresOn = scheduleValue(source, 'expiresOn', 'expires_on');
  const hasSchedule = typeof scheduleTime1 === 'string' && RADAR_TIME_RE.test(scheduleTime1);
  const hasSecondSchedule = scheduleTime2 !== null && scheduleTime2 !== '';
  if (requireSchedule && (!hasSchedule || !validIsoDate(expiresOn))) {
    const error = new Error(RADAR_SCHEDULE_MESSAGE);
    error.code = 'INVALID_RADAR_SCHEDULE';
    throw error;
  }
  if (scheduleTime1 !== null && scheduleTime1 !== '' && !allowedRadarTime(scheduleTime1)) {
    const error = new Error('Radar times must be in 30-minute steps from 11:00 AM through 11:00 PM.');
    error.code = 'INVALID_RADAR_SCHEDULE';
    throw error;
  }
  if (hasSecondSchedule && !allowedRadarTime(scheduleTime2)) {
    const error = new Error('Radar times must be in 30-minute steps from 11:00 AM through 11:00 PM.');
    error.code = 'INVALID_RADAR_SCHEDULE';
    throw error;
  }
  if (hasSecondSchedule && scheduleTime1 === scheduleTime2) {
    const error = new Error('Choose two different Radar times.');
    error.code = 'INVALID_RADAR_SCHEDULE';
    throw error;
  }
  if (expiresOn !== null && expiresOn !== '' && !validIsoDate(expiresOn)) {
    const error = new Error('The Radar expiry date must use YYYY-MM-DD.');
    error.code = 'INVALID_RADAR_SCHEDULE';
    throw error;
  }
  if (expiresOn && expiresOn < zonedToday()) {
    const error = new Error('The Radar expiry date cannot be in the past.');
    error.code = 'INVALID_RADAR_SCHEDULE';
    throw error;
  }

  if (
    minVolumeRatio == null ||
    minVolumeRatio < MIN_VOLUME_RATIO ||
    minVolumeRatio > 100 ||
    minMarketCap == null ||
    minMarketCap < MIN_MARKET_CAP ||
    minMarketCap > MAX_MARKET_CAP ||
    minVolume == null ||
    minVolume < 0 ||
    minVolume > 100_000_000_000_000 ||
    minPrice == null ||
    minPrice < 0 ||
    minPrice > 10_000_000 ||
    maxPrice == null ||
    maxPrice < 0 ||
    maxPrice > 10_000_000 ||
    (maxPrice > 0 && minPrice > maxPrice) ||
    !MA_PERIODS.includes(maPeriod) ||
    !MA_DISTANCES.includes(maDistance) ||
    !MA_INTERVALS.includes(maInterval) ||
    !MA_DIRECTIONS.includes(maDirection)
  ) {
    const error = new Error(`Radar supports Min Ratio ≥ ${MIN_VOLUME_RATIO} and Min Cap ≥ $${MIN_MARKET_CAP / 1e9}B`);
    error.code = 'INVALID_RADAR_FILTERS';
    throw error;
  }

  return {
    name: cleanName(source.name),
    mode,
    selectedSectors,
    minVolumeRatio,
    minMarketCap,
    minVolume,
    minPrice,
    maxPrice,
    maPeriod,
    maDistance,
    maInterval,
    maDirection,
    conditionMode,
    conditionVersion: CONDITION_VERSION,
    scheduleTime1: hasSchedule ? scheduleTime1 : null,
    scheduleTime2: hasSecondSchedule ? scheduleTime2 : null,
    expiresOn: expiresOn || null,
  };
}

function parseSelectedSectors(row) {
  try {
    const parsed = JSON.parse(row.selected_sectors_json || '[]');
    return parseSectors(parsed);
  } catch (_) {
    return [];
  }
}

function statusForRow(row) {
  if (row.expires_on && row.expires_on < zonedToday()) {
    return { state: 'expired', message: 'This Radar expired. Choose a new expiry date to activate it again.' };
  }
  if (!row.schedule_time_1 || !row.expires_on) {
    return { state: 'needs_schedule', message: RADAR_SCHEDULE_MESSAGE };
  }
  const hasSuccess = !!row.last_success_at;
  const dataStatus = row.last_data_status || (Number(row.last_partial_count || 0) > 0 ? 'partial' : null);
  const partial = dataStatus === 'partial' || Number(row.last_partial_count || 0) > 0;
  if (row.last_error === 'SCAN_UNAVAILABLE' || dataStatus === 'unavailable') {
    return { state: 'unavailable', message: DATA_UNAVAILABLE_MESSAGE };
  }
  if (!hasSuccess && row.last_error) {
    return { state: 'unavailable', message: DATA_UNAVAILABLE_MESSAGE };
  }
  if (!hasSuccess) {
    return { state: 'waiting', message: 'WAITING FOR A SIGNAL' };
  }
  if (partial) {
    return { state: 'partial', message: PARTIAL_DATA_MESSAGE };
  }
  return { state: 'ready', message: null };
}

function serializeRadar(row, events) {
  const status = statusForRow(row);
  return {
    id: Number(row.id),
    name: row.name,
    mode: row.mode,
    selectedSectors: parseSelectedSectors(row),
    minVolumeRatio: Number(row.min_volume_ratio),
    minMarketCap: Number(row.min_market_cap),
    minVolume: Number(row.min_volume || 0),
    minPrice: Number(row.min_price || 0),
    maxPrice: Number(row.max_price || 0),
    scheduleTime1: row.schedule_time_1 || null,
    scheduleTime2: row.schedule_time_2 || null,
    expiresOn: row.expires_on || null,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckAt: row.last_check_at || null,
    lastSuccessAt: row.last_success_at || null,
    nextCheckAt: null,
    partialCount: Number(row.last_partial_count || 0),
    dataStatus: status.state,
    statusMessage: status.message,
    maPeriod: Number(row.ma_period || 20),
    maDistance: Number(row.ma_distance || 2),
    maInterval: row.ma_interval || '1d',
    maDirection: row.ma_direction || 'all',
    conditionMode: CONDITION_MODES.includes(String(row.condition_mode || '')) ? row.condition_mode : 'both',
    conditionVersion: row.condition_version || CONDITION_VERSION,
    lastDataStatus: row.last_data_status || 'waiting',
    lastDataAsOf: row.last_data_as_of || null,
    lastScanRunId: row.last_scan_run_id || null,
    maxScansPerDay: MAX_RADAR_SCANS_PER_DAY,
    scheduleTimezone: RADAR_TIMEZONE,
    events: events || [],
  };
}

function rowToConfig(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: row.name,
    mode: row.mode,
    selectedSectors: parseSelectedSectors(row),
    minVolumeRatio: Number(row.min_volume_ratio),
    minMarketCap: Number(row.min_market_cap),
    minVolume: Number(row.min_volume || 0),
    minPrice: Number(row.min_price || 0),
    maxPrice: Number(row.max_price || 0),
    maPeriod: Number(row.ma_period || 20),
    maDistance: Number(row.ma_distance || 2),
    maInterval: row.ma_interval || '1d',
    maDirection: row.ma_direction || 'all',
    conditionMode: CONDITION_MODES.includes(String(row.condition_mode || '')) ? row.condition_mode : 'both',
    conditionVersion: row.condition_version || CONDITION_VERSION,
    scheduleTime1: row.schedule_time_1 || null,
    scheduleTime2: row.schedule_time_2 || null,
    expiresOn: row.expires_on || null,
    active: !!row.active,
  };
}

function serializeEvent(row) {
  let payload = null;
  try {
    payload = JSON.parse(row.payload_json || 'null');
  } catch (_) {}
  return {
    id: Number(row.id),
    symbol: row.symbol,
    scanTime: row.scan_time,
    createdAt: row.created_at,
    delivered: !!row.notified_at,
    data: payload,
  };
}

async function getEventRows(userId, radarId) {
  const rows = await db
    .prepare(
      `SELECT id, symbol, scan_time, payload_json, created_at, notified_at
         FROM radar_events
        WHERE user_id = ? AND radar_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(userId, radarId, MAX_EVENTS_PER_RADAR);
  return rows.map(serializeEvent);
}

async function getRadarRowForUser(userId, radarId) {
  return db.prepare('SELECT * FROM capital_flow_radars WHERE id = ? AND user_id = ?').get(radarId, userId);
}

async function getRadarBundle(userId) {
  const rows = await db
    .prepare('SELECT * FROM capital_flow_radars WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
  const events = await db
    .prepare(
      `SELECT id, radar_id, symbol, scan_time, payload_json, created_at, notified_at
         FROM radar_events
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(userId, MAX_RADARS_PER_USER * MAX_EVENTS_PER_RADAR);
  const grouped = new Map();
  events.forEach((event) => {
    const key = Number(event.radar_id);
    if (!grouped.has(key)) grouped.set(key, []);
    const list = grouped.get(key);
    if (list.length < MAX_EVENTS_PER_RADAR) list.push(serializeEvent(event));
  });
  return rows.map((row) => serializeRadar(row, grouped.get(Number(row.id)) || []));
}

async function createRadar(userId, input) {
  const config = normalizeRadarInput(input);
  const existingCount = await db
    .prepare('SELECT COUNT(*) AS count FROM capital_flow_radars WHERE user_id = ?')
    .get(userId);
  if (Number(existingCount && existingCount.count) >= MAX_RADARS_PER_USER) {
    throw radarLimitError();
  }

  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO capital_flow_radars
          (user_id, name, mode, selected_sectors_json, min_volume_ratio, min_market_cap,
           min_volume, min_price, max_price, ma_period, ma_distance, ma_interval, ma_direction,
           condition_mode, condition_version, schedule_time_1, schedule_time_2, expires_on, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        userId,
        config.name,
        config.mode,
        JSON.stringify(config.selectedSectors),
        config.minVolumeRatio,
        config.minMarketCap,
        config.minVolume,
        config.minPrice,
        config.maxPrice,
        config.maPeriod,
        config.maDistance,
        config.maInterval,
        config.maDirection,
        config.conditionMode,
        config.conditionVersion,
        config.scheduleTime1,
        config.scheduleTime2,
        config.expiresOn
      );
  } catch (error) {
    if (isActiveRadarUniqueError(error)) throw radarLimitError();
    throw error;
  }
  return getRadarRowForUser(userId, result.lastInsertRowid);
}

async function updateRadar(userId, radarId, input) {
  const existing = await getRadarRowForUser(userId, radarId);
  if (!existing) return null;
  const base = {
    name: existing.name,
    mode: existing.mode,
    selectedSectors: parseSelectedSectors(existing),
    minVolumeRatio: existing.min_volume_ratio,
    minMarketCap: existing.min_market_cap,
    minVolume: existing.min_volume,
    minPrice: existing.min_price,
    maxPrice: existing.max_price,
    maPeriod: existing.ma_period,
    maDistance: existing.ma_distance,
    maInterval: existing.ma_interval,
    maDirection: existing.ma_direction,
    conditionMode: existing.condition_mode,
    scheduleTime1: existing.schedule_time_1,
    scheduleTime2: existing.schedule_time_2,
    expiresOn: existing.expires_on,
  };
  const config = normalizeRadarInput(input, base, { requireSchedule: input.active !== false });
  const active = typeof input.active === 'boolean' ? (input.active ? 1 : 0) : Number(existing.active) ? 1 : 0;
  if (active && !existing.active) {
    const activeCount = await db
      .prepare('SELECT COUNT(*) AS count FROM capital_flow_radars WHERE user_id = ? AND active = 1')
      .get(userId);
    if (Number(activeCount && activeCount.count) >= MAX_ACTIVE_RADARS_PER_USER) {
      throw radarLimitError(RADAR_ACTIVE_LIMIT_MESSAGE, 'RADAR_ACTIVE_LIMIT_REACHED');
    }
  }

  try {
    await db
      .prepare(
        `UPDATE capital_flow_radars
            SET name = ?, mode = ?, selected_sectors_json = ?, min_volume_ratio = ?, min_market_cap = ?,
                min_volume = ?, min_price = ?, max_price = ?, ma_period = ?, ma_distance = ?, ma_interval = ?,
                ma_direction = ?, condition_mode = ?, condition_version = ?, schedule_time_1 = ?, schedule_time_2 = ?,
                expires_on = ?, active = ?, updated_at = unixepoch()
          WHERE id = ? AND user_id = ?`
      )
      .run(
        config.name,
        config.mode,
        JSON.stringify(config.selectedSectors),
        config.minVolumeRatio,
        config.minMarketCap,
        config.minVolume,
        config.minPrice,
        config.maxPrice,
        config.maPeriod,
        config.maDistance,
        config.maInterval,
        config.maDirection,
        config.conditionMode,
        config.conditionVersion,
        config.scheduleTime1,
        config.scheduleTime2,
        config.expiresOn,
        active,
        radarId,
        userId
      );
  } catch (error) {
    if (isActiveRadarUniqueError(error)) {
      throw radarLimitError(RADAR_ACTIVE_LIMIT_MESSAGE, 'RADAR_ACTIVE_LIMIT_REACHED');
    }
    throw error;
  }
  return getRadarRowForUser(userId, radarId);
}

async function deleteRadar(userId, radarId) {
  const result = await db.transaction([
    { sql: 'DELETE FROM radar_events WHERE radar_id = ? AND user_id = ?', args: [radarId, userId] },
    // Child rows do not carry a user_id. Keep the ownership predicate on
    // every delete so a forged Radar id cannot erase another user's state or
    // schedule history while the parent row remains protected below.
    {
      sql: `DELETE FROM radar_states
              WHERE radar_id = ?
                AND EXISTS (
                  SELECT 1 FROM capital_flow_radars
                   WHERE id = ? AND user_id = ?
                )`,
      args: [radarId, radarId, userId],
    },
    {
      sql: `DELETE FROM radar_schedule_runs
              WHERE radar_id = ?
                AND EXISTS (
                  SELECT 1 FROM capital_flow_radars
                   WHERE id = ? AND user_id = ?
                )`,
      args: [radarId, radarId, userId],
    },
    { sql: 'DELETE FROM capital_flow_radars WHERE id = ? AND user_id = ?', args: [radarId, userId] },
  ]);
  const last = Array.isArray(result) ? result[result.length - 1] : null;
  return !!(last && Number(last.rowsAffected) > 0);
}

function eventPayload(row, scanTime, meta = {}) {
  const numeric = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    symbol: String(row.symbol || '').toUpperCase(),
    name: String(row.name || row.symbol || '').slice(0, 120),
    price: numeric(row.price),
    change: numeric(row.change),
    volumeRatio: numeric(row.volumeRatio),
    rvol: numeric(row.rvol),
    marketCap: numeric(row.marketCap),
    volume: numeric(row.volume),
    avgVolume: numeric(row.avgVolume),
    sector: row.sector ? String(row.sector).slice(0, 80) : null,
    exchange: row.exchange ? String(row.exchange).slice(0, 40) : null,
    maValue: numeric(row.maValue),
    maDistance: numeric(row.maDistance),
    maDirection: row.maDirection ? String(row.maDirection).slice(0, 10) : null,
    maPeriod: numeric(row.maPeriod),
    maInterval: row.maInterval ? String(row.maInterval).slice(0, 10) : null,
    conditionMode: meta.conditionMode === 'either' ? 'either' : 'both',
    matchedConditions: Array.isArray(meta.matchedConditions)
      ? meta.matchedConditions.filter((item) => item === 'Capital Flow' || item === 'Moving Average')
      : [],
    conditionVersion: meta.conditionVersion || CONDITION_VERSION,
    scanId: meta.scanId || null,
    dataStatus: meta.dataStatus || 'complete',
    dataAsOf: meta.dataAsOf || scanTime,
    scanTime,
  };
}

function eventBody(payload, reentry) {
  const ratio = Number.isFinite(payload.volumeRatio) ? payload.volumeRatio.toFixed(2) + 'x RVOL' : 'volume signal';
  const price = Number.isFinite(payload.price) ? '$' + payload.price.toFixed(2) : 'price unavailable';
  const ma = Number.isFinite(payload.maDistance)
    ? `SMA${payload.maPeriod || ''} ${payload.maDistance >= 0 ? '+' : ''}${payload.maDistance.toFixed(2)}%`
    : 'moving-average condition';
  const matched = Array.isArray(payload.matchedConditions) ? payload.matchedConditions : [];
  const conditionText =
    payload.conditionMode === 'either'
      ? matched.length > 0
        ? `matches ${matched.join(' + ')}`
        : 'matches a Radar condition'
      : 'meets both Radar conditions';
  return `${reentry ? 'Re-entry' : 'New entry'}: ${payload.symbol} ${conditionText} · ${ratio} · ${ma} · ${price}`;
}

async function dispatchRadarEvent(radar, event) {
  const payload = eventPayload(event.row, event.scanTime, event.meta);
  const title = `Capital Flow Radar · ${payload.symbol}`;
  const body = eventBody(payload, event.reentry);
  const eventRow = await db
    .prepare('SELECT id, notified_at FROM radar_events WHERE radar_id = ? AND symbol = ? AND scan_time = ?')
    .get(radar.id, payload.symbol, event.scanTime);
  if (!eventRow || eventRow.notified_at) return;

  // Persist the in-app notification first. This is the durable source of
  // truth even when a browser has no active push subscription.
  try {
    const notificationId = await require('./notifications').addNotification(radar.user_id, {
      symbol: payload.symbol,
      title,
      body,
      scanType: 'capitalFlowRadar',
      results: [payload],
    });

    try {
      require('../routes/stream').broadcastToUser(radar.user_id, 'radar-event', {
        id: eventRow.id,
        notificationId,
        radarId: radar.id,
        title,
        body,
        symbol: payload.symbol,
        data: payload,
      });
    } catch (err) {
      reportError(err, '[Radar SSE]');
    }

    try {
      await require('./webPush').sendPushToUser(radar.user_id, {
        symbol: payload.symbol,
        title,
        body,
        radarId: radar.id,
        scanTime: event.scanTime,
      });
    } catch (err) {
      // Push failure is recorded but never turns a valid Radar event into a
      // failed scan. The in-app notification remains available.
      await db
        .prepare('UPDATE radar_events SET notification_error = ? WHERE id = ?')
        .run('push_delivery_failed', eventRow.id)
        .catch((recordErr) => reportError(recordErr, '[Radar push failure record]'));
      reportError(err, '[Radar push]');
    }

    await db.prepare('UPDATE radar_events SET notified_at = unixepoch() WHERE id = ?').run(eventRow.id);
  } catch (err) {
    // A notification persistence error must not stop other Radars from being
    // evaluated. Leave the event unmarked so an operator can retry safely,
    // while the unique event row still prevents duplicate creation.
    reportError(err, '[Radar notification]');
  }
}

async function getStates(radarId) {
  const rows = await db
    .prepare(
      `SELECT symbol, matches, entered_at, last_seen_at, missed_checks
         FROM radar_states WHERE radar_id = ?`
    )
    .all(radarId);
  const states = new Map();
  rows.forEach((row) => {
    states.set(String(row.symbol).toUpperCase(), {
      matches: Number(row.matches) === 1,
      enteredAt: row.entered_at || null,
      lastSeenAt: row.last_seen_at || null,
      missedChecks: Number(row.missed_checks || 0),
    });
  });
  return states;
}

/**
 * Evaluate the explicitly scheduled Radars against one completed scan. The
 * caller supplies the due ids for this time slot; no provider is called here
 * and no AI analysis is generated in the alert path.
 */
async function processRadarScan(results, scanTime, meta) {
  const scanMeta = meta || {};
  const radarIds = [
    ...new Set(
      (scanMeta.radarIds ? scanMeta.radarIds : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];
  // Regular background scans must not evaluate Radar recipes. Only the
  // scheduled worker supplies explicit ids, so Radar never falls back to
  // continuous processing.
  if (radarIds.length === 0) return [];
  const dataStatus =
    scanMeta.dataStatus || (Array.isArray(scanMeta.errors) && scanMeta.errors.length ? 'partial' : 'complete');
  if (
    !Array.isArray(results) ||
    !scanTime ||
    Number.isNaN(new Date(scanTime).getTime()) ||
    dataStatus === 'unavailable'
  ) {
    await markRadarsUnavailable(radarIds);
    return [];
  }

  const idPlaceholders = radarIds.map(() => '?').join(',');
  const activeRows = await db
    .prepare(
      `SELECT r.*, u.email AS owner_email, u.is_pilot AS owner_is_pilot, u.tier AS owner_tier, u.created_at AS owner_created_at
         FROM capital_flow_radars r
         JOIN users u ON u.id = r.user_id
        WHERE r.active = 1
          AND r.id IN (${idPlaceholders})
          AND r.expires_on >= ?
        ORDER BY r.id`
    )
    .all(...radarIds, zonedToday());
  const activeRadars = activeRows.filter((row) => {
    const isConfiguredAdmin =
      !!ADMIN_EMAIL && String(row.owner_email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return (
      !!row.owner_is_pilot ||
      isConfiguredAdmin ||
      row.owner_tier === 'elite' ||
      (row.owner_tier === 'free' && freeTrialActive({ created_at: row.owner_created_at }))
    );
  });
  const unavailableCapitalFlowSymbols = Array.isArray(scanMeta.unavailableCapitalFlowSymbols)
    ? scanMeta.unavailableCapitalFlowSymbols
    : [];
  const unavailableMovingAverageSymbols = Array.isArray(scanMeta.unavailableMovingAverageSymbols)
    ? scanMeta.unavailableMovingAverageSymbols
    : [];
  const unavailableSymbols = [
    ...(Array.isArray(scanMeta.errors) ? scanMeta.errors : []),
    ...unavailableCapitalFlowSymbols,
    ...unavailableMovingAverageSymbols,
  ];
  const checkedSymbols = Array.isArray(scanMeta.checkedSymbols) ? scanMeta.checkedSymbols : [];
  const conditionStatusByRadarId = scanMeta.conditionStatusByRadarId || {};
  const scanId = String(scanMeta.scanId || `radar-${new Date(scanTime).getTime()}`);
  const dataAsOf = scanMeta.dataAsOf || scanTime;
  const emitted = [];

  for (const radar of activeRadars) {
    try {
      const config = rowToConfig(radar);
      const states = await getStates(config.id);
      const resultRowsBySymbol = new Map(
        results
          .map((row) => [
            String(row && row.symbol ? row.symbol : '')
              .trim()
              .toUpperCase(),
            row,
          ])
          .filter(([symbol]) => symbol)
      );
      const sectorUnavailableSymbols =
        config.mode === 'sectors'
          ? checkedSymbols
              .filter((symbol) => resultRowsBySymbol.has(String(symbol).toUpperCase()))
              .filter((symbol) => {
                const sector = String(resultRowsBySymbol.get(String(symbol).toUpperCase())?.sector || '').trim();
                return !sector || sector === 'N/A' || sector === 'Pending';
              })
              .map((symbol) => String(symbol).toUpperCase())
          : [];
      const radarUnavailableSymbols = [...new Set([...unavailableSymbols, ...sectorUnavailableSymbols])];
      const radarErrorDetails = [
        ...unavailableSymbols,
        ...sectorUnavailableSymbols.map((symbol) => `SECTOR_DATA_UNAVAILABLE:${symbol}`),
      ];
      const radarConditionStatus = conditionStatusByRadarId[String(config.id)] || dataStatus;
      const radarDataStatus =
        sectorUnavailableSymbols.length > 0 && radarConditionStatus === 'complete' ? 'partial' : radarConditionStatus;
      const evaluation = evaluateRadarTransitions(config, results, states, {
        scanTime,
        unavailableSymbols: radarUnavailableSymbols,
        checkedSymbols,
        dataStatus: radarDataStatus,
        unavailableCapitalFlowSymbols,
        unavailableMovingAverageSymbols,
        universe: UNIVERSE,
      });
      const statements = [
        {
          sql: `INSERT OR IGNORE INTO radar_run_snapshots
                  (scan_id, started_at, completed_at, capital_flow_as_of, ma_as_of, data_status,
                   condition_version, ma_period, ma_distance, ma_interval, ma_direction,
                   result_count, checked_count, error_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            scanId,
            scanMeta.startedAt || scanTime,
            scanTime,
            scanMeta.capitalFlowAsOf || dataAsOf,
            scanMeta.maAsOf || dataAsOf,
            radarDataStatus,
            config.conditionVersion || CONDITION_VERSION,
            config.maPeriod,
            config.maDistance,
            config.maInterval,
            // The shared MA request is direction-neutral; each Radar applies
            // its own above/below preference locally during evaluation.
            scanMeta.maDirection || 'all',
            results.length,
            checkedSymbols.length || (radarDataStatus === 'complete' ? results.length : 0),
            JSON.stringify(radarErrorDetails.slice(0, 100)),
          ],
        },
      ];

      // Persist exactly the pure evaluator's next state. This keeps partial
      // provider responses from incrementing a symbol that was not actually
      // checked, and removes the old duplicate SQL transition logic.
      evaluation.nextStates.forEach((state, symbol) => {
        statements.push({
          sql: `INSERT INTO radar_states
                  (radar_id, symbol, matches, entered_at, last_seen_at, missed_checks)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(radar_id, symbol) DO UPDATE SET
                  matches = excluded.matches,
                  entered_at = excluded.entered_at,
                  last_seen_at = excluded.last_seen_at,
                  missed_checks = excluded.missed_checks`,
          args: [radar.id, symbol, state.matches ? 1 : 0, state.enteredAt, state.lastSeenAt, state.missedChecks],
        });
      });

      const partialCount = radarUnavailableSymbols.length;
      const lastError = radarDataStatus === 'partial' ? 'PARTIAL_DATA' : null;
      statements.push({
        sql: `UPDATE capital_flow_radars
                 SET last_check_at = ?, last_success_at = ?, last_error = ?, last_error_detail = ?,
                     last_data_status = ?, last_data_as_of = ?, last_scan_run_id = ?,
                     last_partial_count = ?, updated_at = unixepoch()
               WHERE id = ?`,
        args: [
          evaluation.scanTime,
          evaluation.scanTime,
          lastError,
          radarErrorDetails.length > 0 ? JSON.stringify(radarErrorDetails.slice(0, 100)) : null,
          radarDataStatus,
          dataAsOf,
          scanId,
          partialCount,
          radar.id,
        ],
      });

      evaluation.events.forEach((event) => {
        const payload = eventPayload(event.row, evaluation.scanTime, {
          ...scanMeta,
          scanId,
          dataStatus: radarDataStatus,
          dataAsOf,
          conditionVersion: config.conditionVersion || CONDITION_VERSION,
          conditionMode: config.conditionMode,
          matchedConditions: event.matchedConditions,
        });
        statements.push({
          sql: `INSERT OR IGNORE INTO radar_events
                  (radar_id, user_id, symbol, scan_time, payload_json)
                VALUES (?, ?, ?, ?, ?)`,
          args: [radar.id, radar.user_id, payload.symbol, evaluation.scanTime, JSON.stringify(payload)],
        });
      });

      await db.transaction(statements);
      for (const event of evaluation.events) {
        emitted.push({ radarId: config.id, userId: config.user_id, symbol: event.symbol, scanTime: event.scanTime });
        await dispatchRadarEvent(config, {
          ...event,
          meta: {
            ...scanMeta,
            scanId,
            dataStatus: radarDataStatus,
            dataAsOf,
            conditionVersion: config.conditionVersion,
            conditionMode: config.conditionMode,
            matchedConditions: event.matchedConditions,
          },
        });
      }
    } catch (err) {
      // One malformed user recipe or one transient DB error cannot disable
      // every other user's Radar.
      reportError(err, `[Radar ${radar.id}]`);
      await db
        .prepare(
          `UPDATE capital_flow_radars
              SET last_check_at = ?, last_error = 'SCAN_UNAVAILABLE', last_error_detail = ?,
                  last_data_status = 'unavailable', last_data_as_of = ?, updated_at = unixepoch()
            WHERE id = ?`
        )
        .run(
          new Date().toISOString(),
          JSON.stringify([err.code || 'RADAR_PROCESSING_FAILED']),
          new Date().toISOString(),
          radar.id
        )
        .catch((stateErr) => reportError(stateErr, `[Radar ${radar.id}] failure status persistence`));
    }
  }
  return emitted;
}

async function markRadarsUnavailable(radarIds, metadata = {}) {
  const ids = [...new Set((radarIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const checkedAt = metadata.dataAsOf || new Date().toISOString();
  const errorDetail =
    Array.isArray(metadata.errors) && metadata.errors.length > 0 ? JSON.stringify(metadata.errors.slice(0, 100)) : null;
  await db
    .prepare(
      `UPDATE capital_flow_radars
          SET last_check_at = ?, last_error = 'SCAN_UNAVAILABLE', last_error_detail = ?,
              last_data_status = 'unavailable', last_data_as_of = ?, last_scan_run_id = ?,
              last_partial_count = 0, updated_at = unixepoch()
        WHERE active = 1 AND id IN (${placeholders})`
    )
    .run(checkedAt, errorDetail, checkedAt, metadata.scanId || null, ...ids);
}

module.exports = {
  RADAR_TIMEZONE,
  MAX_RADAR_SCANS_PER_DAY,
  MIN_VOLUME_RATIO,
  MIN_MARKET_CAP,
  MAX_RADARS_PER_USER,
  MAX_ACTIVE_RADARS_PER_USER,
  RADAR_LIMIT_MESSAGE,
  RADAR_ACTIVE_LIMIT_MESSAGE,
  DATA_UNAVAILABLE_MESSAGE,
  PARTIAL_DATA_MESSAGE,
  normalizeRadarInput,
  getRadarBundle,
  getRadarRowForUser,
  rowToConfig,
  getEventRows,
  createRadar,
  updateRadar,
  deleteRadar,
  eventPayload,
  processRadarScan,
  markRadarsUnavailable,
  serializeRadar,
  zonedToday,
};
