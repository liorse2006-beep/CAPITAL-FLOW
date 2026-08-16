const crypto = require('crypto');
const dns = require('dns').promises;
const tls = require('tls');
const db = require('../db');
const {
  ADMIN_EMAIL,
  RESEND_API_KEY,
  STATUS_ALERT_RECIPIENTS,
  STATUS_CHECK_INTERVAL_MS,
  STATUS_FAILURE_CONFIRMATIONS,
  STATUS_MONITOR_ENABLED,
  STATUS_RAW_RETENTION_DAYS,
  STATUS_RECOVERY_CONFIRMATIONS,
  STATUS_RETRY_DELAY_MS,
  STATUS_INTERNAL_TOKEN,
} = require('../config');
const { sendStatusIncidentAlert, sendStatusRecoveryAlert } = require('./email');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { reportError, safeErrorSummary } = require('../utils/reportError');
const { getComponentDefinitions, getStatusTargetUrl } = require('./statusConfig');

const FAILURE_CONFIRMATIONS = STATUS_FAILURE_CONFIRMATIONS;
const RECOVERY_CONFIRMATIONS = STATUS_RECOVERY_CONFIRMATIONS;
const state = { running: false, cyclePromise: null, timer: null, startedAt: null };

function now() {
  return Math.floor(Date.now() / 1000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function publicErrorFor(component, result) {
  if (result && result.metadata && result.metadata.certificateDays != null) {
    return `Certificate expires in ${result.metadata.certificateDays} days.`;
  }
  if (component.key === 'website') return 'The public website is not responding normally.';
  if (component.key === 'database') return 'Database health verification failed.';
  if (component.key === 'authentication') return 'Authentication service is not responding normally.';
  if (component.group === 'External dependencies') return 'An external provider is not responding normally.';
  return `${component.name} is not responding normally.`;
}

function classifyResult(component, result) {
  if (!result.success) return 'failed';
  if (result.responseMs >= component.verySlowMs) return 'degraded';
  if (result.responseMs >= component.slowMs) return 'degraded';
  if (result.metadata && result.metadata.warning) return 'degraded';
  return 'operational';
}

function getUrl(path) {
  return getStatusTargetUrl() + (path || '');
}

async function readHttpCheck(component) {
  const headers = { Accept: 'application/json, text/html;q=0.9' };
  if (component.type === 'market-data' && STATUS_INTERNAL_TOKEN)
    headers['x-status-check-token'] = STATUS_INTERNAL_TOKEN;
  const request = {
    headers,
    redirect: component.redirect || 'follow',
    method: component.method || 'GET',
  };
  if (component.body != null) {
    headers['Content-Type'] = 'application/json';
    request.body = typeof component.body === 'string' ? component.body : JSON.stringify(component.body);
  }
  const response = await fetchWithTimeout(getUrl(component.path), request, component.timeoutMs);
  const text = await response.text();
  const json = parseJson(text);
  let success = response.status === component.expectedStatus;
  let errorMessage = success ? null : `HTTP ${response.status}`;

  if (success && component.type === 'http-content') {
    for (const marker of component.contentIncludes || []) {
      if (!text.includes(marker)) {
        success = false;
        errorMessage = 'Expected page content was not found.';
        break;
      }
    }
  }
  if (success && component.type === 'health-json') {
    if (!json || json.status !== 'ok') {
      success = false;
      errorMessage = 'Health response was not structurally valid.';
    }
  }
  if (success && component.type === 'database-json') {
    if (!json || json.status !== 'ok' || !json.db || json.db.status !== 'ok') {
      success = false;
      errorMessage = 'Database health response was not structurally valid.';
    }
  }
  if (success && component.type === 'auth-route' && response.status !== 401) {
    success = false;
    errorMessage = 'Anonymous authentication probe returned an unexpected status.';
  }
  if (success && component.type === 'market-data' && (!json || json.ok !== true || !json.sample)) {
    success = false;
    errorMessage = 'Known-symbol market-data response was not structurally valid.';
  }
  if (success && component.type === 'news-sample' && response.status !== 401) {
    success = false;
    errorMessage = 'News route returned an unexpected anonymous response.';
  }

  return {
    success,
    statusCode: response.status,
    responseMs: null,
    errorMessage,
    timedOut: false,
    metadata: json && component.type === 'market-data' ? { provider: json.provider, sample: json.sample.symbol } : null,
  };
}

async function checkYahoo(component) {
  const response = await fetchWithTimeout(
    'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d',
    { headers: { Accept: 'application/json' } },
    component.timeoutMs
  );
  const text = await response.text();
  const json = parseJson(text);
  const valid =
    response.ok &&
    json &&
    json.chart &&
    Array.isArray(json.chart.result) &&
    json.chart.result.length > 0 &&
    json.chart.result[0].meta;
  return {
    success: !!valid,
    statusCode: response.status,
    responseMs: null,
    errorMessage: valid ? null : response.ok ? 'Yahoo response was not structurally valid.' : `HTTP ${response.status}`,
    timedOut: false,
    metadata: valid ? { provider: 'Yahoo Finance', symbol: 'AAPL' } : null,
  };
}

async function checkDns(component) {
  const host = new URL(getStatusTargetUrl()).hostname;
  const addresses = await dns.lookup(host, { all: true });
  return {
    success: addresses.length > 0,
    statusCode: null,
    responseMs: null,
    errorMessage: addresses.length ? null : 'No DNS address was returned.',
    timedOut: false,
    metadata: { host, addresses: addresses.map((entry) => entry.address) },
  };
}

function checkSsl(component) {
  return new Promise((resolve, reject) => {
    const url = new URL(getStatusTargetUrl());
    const started = Date.now();
    const socket = tls.connect(
      {
        host: url.hostname,
        port: Number(url.port) || 443,
        servername: url.hostname,
        rejectUnauthorized: false,
        timeout: component.timeoutMs,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        socket.end();
        if (!certificate || !certificate.valid_to) {
          resolve({
            success: false,
            statusCode: null,
            responseMs: Date.now() - started,
            errorMessage: 'No certificate was returned.',
            timedOut: false,
          });
          return;
        }
        const certificateDays = Math.floor((Date.parse(certificate.valid_to) - Date.now()) / 86400000);
        const authorized = socket.authorized;
        resolve({
          success: authorized && certificateDays >= 0,
          statusCode: null,
          responseMs: Date.now() - started,
          errorMessage: authorized && certificateDays >= 0 ? null : 'TLS certificate is invalid or expired.',
          timedOut: false,
          metadata: { certificateDays, warning: certificateDays < 14 },
        });
      }
    );
    socket.once('timeout', () => {
      socket.destroy();
      reject(Object.assign(new Error('TLS check timed out'), { code: 'ETIMEDOUT' }));
    });
    socket.once('error', reject);
  });
}

async function checkComponent(component) {
  const started = Date.now();
  try {
    let result;
    if (component.type === 'external-yahoo') result = await checkYahoo(component);
    else if (component.type === 'dns') result = await checkDns(component);
    else if (component.type === 'ssl') result = await checkSsl(component);
    else result = await readHttpCheck(component);
    result.responseMs = result.responseMs == null ? Date.now() - started : result.responseMs;
    result.state = classifyResult(component, result);
    return result;
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError' || err.code === 'ETIMEDOUT');
    const safeSummary = safeErrorSummary(err);
    return {
      success: false,
      statusCode: null,
      responseMs: Date.now() - started,
      errorMessage:
        timedOut || typeof safeSummary === 'string'
          ? timedOut
            ? 'Request timed out.'
            : safeSummary
          : safeSummary.message || 'Check failed.',
      timedOut,
      metadata: null,
      state: 'failed',
    };
  }
}

async function recordCheck(component, cycleId, attempt, result, finalResult) {
  const checkedAt = now();
  const row = await db
    .prepare(
      `INSERT INTO status_checks
       (cycle_id, component_key, checked_at, attempt, endpoint, check_type, success, state,
        status_code, response_ms, error_message, timed_out, final_result, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cycleId,
      component.key,
      checkedAt,
      attempt,
      component.path || component.type,
      component.type,
      result.success ? 1 : 0,
      result.state,
      result.statusCode == null ? null : result.statusCode,
      result.responseMs == null ? null : Math.round(result.responseMs),
      result.errorMessage || null,
      result.timedOut ? 1 : 0,
      finalResult ? 1 : 0,
      result.metadata ? JSON.stringify(result.metadata) : null
    );
  return Number(row.lastInsertRowid);
}

async function markNonFinal(id) {
  await db.prepare('UPDATE status_checks SET final_result = 0 WHERE id = ?').run(id);
}

async function getRecentFinalOutcomes(componentKey, limit = 12) {
  const rows = await db
    .prepare(
      `SELECT cycle_id, checked_at, success, state, response_ms
       FROM status_checks
       WHERE component_key = ? AND final_result = 1
       ORDER BY checked_at DESC, id DESC
       LIMIT ?`
    )
    .all(componentKey, limit);
  return rows;
}

function consecutive(rows, predicate) {
  let count = 0;
  for (const row of rows) {
    if (!predicate(row)) break;
    count += 1;
  }
  return count;
}

function isFlapping(rows) {
  if (rows.length < 6) return false;
  const recent = rows.slice(0, 8).map((row) => (row.success && row.state === 'operational' ? 'up' : 'down'));
  let transitions = 0;
  for (let i = 1; i < recent.length; i += 1) if (recent[i] !== recent[i - 1]) transitions += 1;
  return transitions >= 4;
}

function severityFor(component) {
  if (component.key === 'website') return 'SEV-1 / Critical';
  if (component.criticality === 'critical' || component.criticality === 'major') return 'SEV-2 / Major';
  if (component.criticality === 'degraded') return 'SEV-3 / Degraded';
  return 'SEV-4 / Warning';
}

function titleFor(component, result) {
  if (result.state === 'degraded') return `${component.name} performance degraded`;
  return `${component.name} unavailable`;
}

function normaliseMaintenanceRows(rows) {
  return rows.map((row) => {
    let affected = [];
    try {
      affected = JSON.parse(row.affected_components);
    } catch (_) {}
    return { ...row, affected_components: Array.isArray(affected) ? affected : [] };
  });
}

async function getActiveMaintenance() {
  const rows = await db
    .prepare('SELECT * FROM status_maintenance WHERE starts_at <= ? AND ends_at >= ? ORDER BY starts_at ASC')
    .all(now(), now());
  return normaliseMaintenanceRows(rows);
}

async function getUpcomingMaintenance() {
  const rows = await db
    .prepare('SELECT * FROM status_maintenance WHERE starts_at > ? ORDER BY starts_at ASC LIMIT 20')
    .all(now());
  return normaliseMaintenanceRows(rows);
}

function maintenanceAffects(maintenance, componentKey) {
  return maintenance.some(
    (entry) => entry.affected_components.includes('*') || entry.affected_components.includes(componentKey)
  );
}

async function getActiveIncident(componentKey) {
  return db
    .prepare(
      `SELECT * FROM status_incidents
       WHERE component_key = ? AND status IN ('investigating', 'identified', 'monitoring')
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(componentKey);
}

async function createIncident(component, cycleId, result, failureCount) {
  const startedAt = now();
  const publicId = `INC-${new Date(startedAt * 1000)
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const title = titleFor(component, result);
  const row = await db
    .prepare(
      `INSERT INTO status_incidents
       (public_id, component_key, title, severity, status, started_at, identified_at,
        failure_count, error_message, public_summary)
       VALUES (?, ?, ?, ?, 'identified', ?, ?, ?, ?, ?)`
    )
    .run(
      publicId,
      component.key,
      title,
      severityFor(component),
      startedAt,
      startedAt,
      failureCount,
      result.errorMessage || 'Unknown failure',
      publicErrorFor(component, result)
    );
  const incidentId = Number(row.lastInsertRowid);
  await db
    .prepare('INSERT INTO status_incident_updates (incident_id, status, message, is_public) VALUES (?, ?, ?, 1)')
    .run(incidentId, 'Investigating', publicErrorFor(component, result));
  await db
    .prepare('UPDATE status_checks SET incident_id = ? WHERE cycle_id = ? AND component_key = ?')
    .run(incidentId, cycleId, component.key);
  return db.prepare('SELECT * FROM status_incidents WHERE id = ?').get(incidentId);
}

async function updateIncidentFailure(incident, component, cycleId, result) {
  const updatedAt = now();
  await db
    .prepare(
      `UPDATE status_incidents
       SET status = 'identified', failure_count = failure_count + 1, recovery_count = 0,
           error_message = ?, public_summary = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(result.errorMessage || incident.error_message, publicErrorFor(component, result), updatedAt, incident.id);
  await db
    .prepare('UPDATE status_checks SET incident_id = ? WHERE cycle_id = ? AND component_key = ?')
    .run(incident.id, cycleId, component.key);
  return db.prepare('SELECT * FROM status_incidents WHERE id = ?').get(incident.id);
}

async function updateIncidentRecovery(incident, component, cycleId, result, recoveryCount) {
  await db
    .prepare(
      `UPDATE status_incidents
       SET status = 'monitoring', recovery_count = ?, monitoring_at = COALESCE(monitoring_at, ?), updated_at = ?
       WHERE id = ?`
    )
    .run(recoveryCount, now(), now(), incident.id);
  await db
    .prepare('UPDATE status_checks SET incident_id = ? WHERE cycle_id = ? AND component_key = ?')
    .run(incident.id, cycleId, component.key);
  return db.prepare('SELECT * FROM status_incidents WHERE id = ?').get(incident.id);
}

async function resolveIncident(incident, component, cycleId, result, recoveryCount) {
  const resolvedAt = now();
  await db
    .prepare(
      `UPDATE status_incidents
       SET status = 'resolved', recovery_count = ?, resolved_at = ?,
           outage_seconds = MAX(0, ? - started_at), updated_at = ?
       WHERE id = ?`
    )
    .run(recoveryCount, resolvedAt, resolvedAt, resolvedAt, incident.id);
  await db
    .prepare('INSERT INTO status_incident_updates (incident_id, status, message, is_public) VALUES (?, ?, ?, 1)')
    .run(incident.id, 'Resolved', 'The system passed multiple consecutive recovery checks and is operational again.');
  await db
    .prepare('UPDATE status_checks SET incident_id = ? WHERE cycle_id = ? AND component_key = ?')
    .run(incident.id, cycleId, component.key);
  return db.prepare('SELECT * FROM status_incidents WHERE id = ?').get(incident.id);
}

function getConfiguredRecipients() {
  const values = [
    ...(STATUS_ALERT_RECIPIENTS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    String(ADMIN_EMAIL || '')
      .trim()
      .toLowerCase(),
  ];
  return [...new Set(values)].filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

async function syncRecipients() {
  const configured = getConfiguredRecipients();
  for (const email of configured) {
    await db
      .prepare(
        `INSERT INTO status_alert_recipients (email, active, source, updated_at)
         VALUES (?, 1, 'environment', ?)
         ON CONFLICT(email) DO UPDATE SET active = 1, updated_at = excluded.updated_at`
      )
      .run(email, now());
  }
  const stored = await db.prepare('SELECT email FROM status_alert_recipients WHERE active = 1').all();
  return [...new Set([...configured, ...stored.map((row) => String(row.email).toLowerCase())])];
}

async function deliverNotification(type, incident, component, result, relatedComponents) {
  const recipients = await syncRecipients();
  for (const recipient of recipients) {
    const previous = await db
      .prepare(
        `SELECT * FROM status_notification_deliveries
         WHERE incident_id = ? AND notification_type = ? AND recipient = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(incident.id, type, recipient);
    if (previous && previous.status === 'sent') continue;
    const attempts = (previous ? previous.attempts : 0) + 1;
    let status = 'sent';
    let error = null;
    try {
      if (!RESEND_API_KEY) {
        status = 'skipped';
        error = 'Transactional email is not configured.';
      } else if (type === 'recovery') {
        await sendStatusRecoveryAlert({ recipient, incident, component, checks: result });
      } else {
        await sendStatusIncidentAlert({ recipient, incident, component, checks: result, relatedComponents });
      }
    } catch (err) {
      status = 'failed';
      error = safeErrorSummary(err);
      reportError(err, `[status ${type} email]`);
    }
    await db
      .prepare(
        `INSERT INTO status_notification_deliveries
         (incident_id, notification_type, recipient, status, attempts, sent_at, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(incident.id, type, recipient, status, attempts, status === 'sent' ? now() : null, error, now());
  }
}

async function correlateComponents() {
  const components = await getComponentDefinitionsFromDb();
  const states = [];
  for (const component of components) {
    const incident = await getActiveIncident(component.key);
    const latest = await db
      .prepare(
        'SELECT success, state FROM status_checks WHERE component_key = ? AND final_result = 1 ORDER BY checked_at DESC, id DESC LIMIT 1'
      )
      .get(component.key);
    states.push({
      name: component.name,
      status: incident
        ? component.key === 'website'
          ? 'Major Outage'
          : 'Partial Outage'
        : latest?.state === 'degraded'
          ? 'Degraded'
          : latest?.success
            ? 'Operational'
            : 'Checking',
    });
  }
  return states.map((entry) => `${entry.name}: ${entry.status}`).join(' · ');
}

async function getComponentDefinitionsFromDb() {
  const catalog = getComponentDefinitions();
  const rows = await db.prepare('SELECT * FROM status_components ORDER BY rowid ASC').all();
  const byKey = new Map(rows.map((row) => [row.component_key, row]));
  return catalog
    .map((base) => {
      const row = byKey.get(base.key);
      return {
        ...base,
        enabled: row ? !!row.enabled : true,
        path: row?.endpoint || base.path,
        timeoutMs: row?.timeout_ms || base.timeoutMs,
        slowMs: row?.slow_ms || base.slowMs,
        verySlowMs: row?.very_slow_ms || base.verySlowMs,
      };
    })
    .filter((component) => component.enabled);
}

async function reconcileComponent(component, cycleId, result) {
  const maintenance = await getActiveMaintenance();
  if (maintenanceAffects(maintenance, component.key)) return { result, incident: null, maintenance: true };
  const active = await getActiveIncident(component.key);
  const recent = await getRecentFinalOutcomes(component.key, 12);
  const failureStreak = consecutive(recent, (row) => !row.success);
  const recoveryStreak = consecutive(recent, (row) => row.success && row.state === 'operational');

  if (!active && !result.success && failureStreak >= FAILURE_CONFIRMATIONS) {
    const incident = await createIncident(component, cycleId, result, failureStreak);
    await deliverNotification('outage', incident, component, result, await correlateComponents());
    return { result, incident, maintenance: false, flapping: isFlapping(recent) };
  }
  if (active && !result.success) {
    const incident = await updateIncidentFailure(active, component, cycleId, result);
    return { result, incident, maintenance: false, flapping: isFlapping(recent) };
  }
  if (active && result.success && recoveryStreak >= RECOVERY_CONFIRMATIONS) {
    const incident = await resolveIncident(active, component, cycleId, result, recoveryStreak);
    await deliverNotification('recovery', incident, component, result, null);
    return { result, incident, maintenance: false, flapping: isFlapping(recent) };
  }
  if (active && result.success) {
    const incident = await updateIncidentRecovery(active, component, cycleId, result, recoveryStreak);
    return { result, incident, maintenance: false, flapping: isFlapping(recent) };
  }
  return { result, incident: null, maintenance: false, flapping: isFlapping(recent) };
}

async function setMeta(key, value) {
  await db
    .prepare(
      `INSERT INTO status_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, String(value), now());
}

async function pruneStatusData() {
  const cutoff = now() - STATUS_RAW_RETENTION_DAYS * 86400;
  await db.prepare('DELETE FROM status_checks WHERE checked_at < ?').run(cutoff);
  await db
    .prepare(
      "DELETE FROM status_incident_updates WHERE created_at < ? AND incident_id IN (SELECT id FROM status_incidents WHERE status = 'resolved')"
    )
    .run(now() - 730 * 86400);
  await db.prepare('DELETE FROM status_notification_deliveries WHERE updated_at < ?').run(now() - 730 * 86400);
}

async function runStatusCycle() {
  if (state.cyclePromise) return state.cyclePromise;
  state.cyclePromise = (async () => {
    const cycleId = crypto.randomUUID();
    const started = Date.now();
    state.startedAt = Math.floor(started / 1000);
    await db.ready;
    await setMeta('cycle_started_at', Math.floor(started / 1000));
    let results = [];
    try {
      const components = await getComponentDefinitionsFromDb();
      results = await Promise.all(
        components.map(async (component) => {
          const first = await checkComponent(component);
          const firstId = await recordCheck(component, cycleId, 1, first, first.success);
          let final = first;
          if (!first.success) {
            await delay(STATUS_RETRY_DELAY_MS);
            await markNonFinal(firstId);
            final = await checkComponent(component);
            await recordCheck(component, cycleId, 2, final, true);
          }
          const outcome = await reconcileComponent(component, cycleId, final);
          return { component, final, ...outcome };
        })
      );
      await setMeta('last_cycle_at', now());
      await setMeta('last_cycle_status', 'success');
      await setMeta('last_cycle_duration_ms', Date.now() - started);
      await setMeta('next_cycle_at', Math.floor((Date.now() + STATUS_CHECK_INTERVAL_MS) / 1000));
      await setMeta('heartbeat_at', now());
      await pruneStatusData();
      return { cycleId, startedAt: Math.floor(started / 1000), finishedAt: now(), results };
    } catch (err) {
      await setMeta('last_cycle_at', now());
      await setMeta('last_cycle_status', 'error');
      await setMeta('last_cycle_error', safeErrorSummary(err));
      reportError(err, '[status monitor cycle]');
      throw err;
    } finally {
      state.startedAt = null;
    }
  })();
  try {
    return await state.cyclePromise;
  } finally {
    state.cyclePromise = null;
  }
}

function startStatusMonitor() {
  if (!STATUS_MONITOR_ENABLED || state.timer) return;
  const run = () => runStatusCycle().catch(() => {});
  const startup = setTimeout(run, 15 * 1000);
  startup.unref();
  state.timer = setInterval(run, STATUS_CHECK_INTERVAL_MS);
  state.timer.unref();
}

async function getMeta() {
  const rows = await db.prepare('SELECT key, value, updated_at FROM status_meta').all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

module.exports = {
  getActiveMaintenance,
  getComponentDefinitionsFromDb,
  getMeta,
  getUpcomingMaintenance,
  getRecentFinalOutcomes,
  isFlapping,
  runStatusCycle,
  startStatusMonitor,
};
