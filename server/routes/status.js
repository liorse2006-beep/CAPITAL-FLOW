const express = require('express');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const { ADMIN_EMAIL, STATUS_INTERNAL_TOKEN, STATUS_CHECK_INTERVAL_MS } = require('../config');
const { checkAdminToken } = require('../services/adminAccess');
const {
  getActiveMaintenance,
  getComponentDefinitionsFromDb,
  getHeartbeatHealth,
  getMeta,
  getRecentFinalOutcomes,
  getUpcomingMaintenance,
  isFlapping,
  runStatusCycle,
} = require('../services/statusMonitor');
const { getFullAdminUrl, getStatusPublicUrl } = require('../services/statusConfig');
const { reportError } = require('../utils/reportError');
const { runStatusBackup } = require('../services/statusDbBackup');

const statusAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many status-admin requests. Please wait a few minutes.' },
});

const statusProbeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many status probe requests.' },
});

router.use('/status/api/admin', statusAdminLimiter);
router.use('/status/internal/market-data', statusProbeLimiter);

function asyncRoute(fn) {
  return function statusAsyncRoute(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      reportError(err, '[status route]');
      if (!res.headersSent) res.status(500).json({ error: 'Status service error' });
    });
  };
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function asNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAffected(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function uptimeFor(componentKey, days) {
  const since = unixNow() - days * 86400;
  const [raw, rollup] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(success), 0) AS successful,
                MIN(checked_at) AS first_check, MAX(checked_at) AS last_check
         FROM status_checks
         WHERE component_key = ? AND final_result = 1 AND checked_at >= ?`
      )
      .get(componentKey, since),
    db
      .prepare(
        `SELECT COALESCE(SUM(total_checks), 0) AS total,
                COALESCE(SUM(successful_checks), 0) AS successful,
                MIN(first_check) AS first_check, MAX(last_check) AS last_check
         FROM status_daily_rollups
         WHERE component_key = ? AND day >= date(?, 'unixepoch')`
      )
      .get(componentKey, since),
  ]);
  const total = Number(raw?.total || 0) + Number(rollup?.total || 0);
  const successful = Number(raw?.successful || 0) + Number(rollup?.successful || 0);
  const firstChecks = [raw?.first_check, rollup?.first_check].filter((value) => value != null).map(Number);
  const lastChecks = [raw?.last_check, rollup?.last_check].filter((value) => value != null).map(Number);
  return {
    availability: total ? Math.round((successful / total) * 10000) / 100 : null,
    checks: total,
    firstCheck: firstChecks.length ? Math.min(...firstChecks) : null,
    lastCheck: lastChecks.length ? Math.max(...lastChecks) : null,
  };
}

async function latestCheck(componentKey) {
  return db
    .prepare(
      `SELECT id, cycle_id, checked_at, success, state, status_code, response_ms,
              endpoint, check_type, timed_out
       FROM status_checks
       WHERE component_key = ? AND final_result = 1
       ORDER BY checked_at DESC, id DESC LIMIT 1`
    )
    .get(componentKey);
}

async function checkBoundaries(componentKey) {
  return db
    .prepare(
      'SELECT MAX(CASE WHEN success = 1 THEN checked_at END) AS last_success, ' +
        'MAX(CASE WHEN success = 0 THEN checked_at END) AS last_failure ' +
        'FROM status_checks WHERE component_key = ? AND final_result = 1'
    )
    .get(componentKey);
}

async function activeIncident(componentKey) {
  return db
    .prepare(
      `SELECT id, public_id, component_key, title, severity, status, started_at,
              identified_at, monitoring_at, failure_count, recovery_count,
              public_summary, created_at, updated_at
       FROM status_incidents
       WHERE component_key = ? AND status IN ('investigating', 'identified', 'monitoring')
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(componentKey);
}

function componentStatus(component, latest, incident, maintenance, flapping) {
  if (maintenance) return 'maintenance';
  if (incident) {
    if (component.key === 'website') return 'major';
    if (component.criticality === 'degraded' || component.criticality === 'warning') return 'degraded';
    return 'partial';
  }
  if (!latest) return 'unknown';
  if (latest.state === 'degraded' || flapping) return 'degraded';
  return latest.success ? 'operational' : 'degraded';
}

function overallStatus(components, incidents, maintenance) {
  const userImpactingComponents = components.filter((component) => component.userImpact !== false);
  const userImpactingIncidents = incidents.filter((incident) => incident.userImpact !== false);
  if (userImpactingIncidents.some((incident) => (incident.component_key || incident.componentKey) === 'website'))
    return 'major';
  if (
    userImpactingIncidents.some((incident) => (incident.component_key || incident.componentKey) === 'monitoring-worker')
  )
    return 'degraded';
  if (userImpactingIncidents.some((incident) => !['SEV-3 / Degraded', 'SEV-4 / Warning'].includes(incident.severity)))
    return 'partial';
  if (userImpactingIncidents.length) return 'degraded';
  if (userImpactingComponents.some((component) => component.status === 'degraded')) return 'degraded';
  if (maintenance.length && userImpactingComponents.some((component) => component.status === 'maintenance'))
    return 'maintenance';
  if (
    userImpactingComponents.length &&
    userImpactingComponents.every((component) => component.status === 'operational')
  )
    return 'operational';
  return 'unknown';
}

async function publicIncidents(limit = 20) {
  const rows = await db
    .prepare(
      `SELECT id, public_id, component_key, title, severity, status, started_at,
              resolved_at, outage_seconds, failure_count, recovery_count,
              public_summary, created_at, updated_at
       FROM status_incidents
       ORDER BY CASE WHEN status IN ('investigating', 'identified', 'monitoring') THEN 0 ELSE 1 END,
                started_at DESC LIMIT ?`
    )
    .all(limit);
  const updates = await db
    .prepare(
      `SELECT incident_id, status, message, created_at
       FROM status_incident_updates
       WHERE is_public = 1 AND incident_id IN (SELECT id FROM status_incidents ORDER BY started_at DESC LIMIT ?)
       ORDER BY created_at ASC`
    )
    .all(limit);
  const byIncident = new Map();
  updates.forEach((update) => {
    if (!byIncident.has(update.incident_id)) byIncident.set(update.incident_id, []);
    byIncident.get(update.incident_id).push(update);
  });
  return rows.map((row) => ({ ...row, updates: byIncident.get(row.id) || [] }));
}

async function dailyHistory(days = 90) {
  const boundedDays = Math.min(90, Math.max(1, Number(days) || 90));
  const since = unixNow() - (boundedDays - 1) * 86400;
  const rawRows = await db
    .prepare(
      `SELECT component_key, date(checked_at, 'unixepoch') AS day,
              COUNT(*) AS total, COALESCE(SUM(success), 0) AS successful,
              COALESCE(SUM(CASE WHEN state = 'degraded' THEN 1 ELSE 0 END), 0) AS degraded,
              MIN(checked_at) AS first_check
       FROM status_checks
       WHERE final_result = 1 AND checked_at >= ?
       GROUP BY component_key, day
       ORDER BY day ASC`
    )
    .all(since);
  const rollupRows = await db
    .prepare(
      `SELECT component_key, day, total_checks AS total,
              successful_checks AS successful, degraded_checks AS degraded,
              first_check
       FROM status_daily_rollups
       WHERE day >= date(?, 'unixepoch')
       ORDER BY day ASC`
    )
    .all(since);
  const combined = new Map();
  for (const row of [...rollupRows, ...rawRows]) {
    const key = row.component_key + '|' + row.day;
    const previous = combined.get(key);
    if (!previous) {
      combined.set(key, {
        ...row,
        total: Number(row.total || 0),
        successful: Number(row.successful || 0),
        degraded: Number(row.degraded || 0),
        first_check: row.first_check || null,
      });
      continue;
    }
    previous.total += Number(row.total || 0);
    previous.successful += Number(row.successful || 0);
    previous.degraded += Number(row.degraded || 0);
    previous.first_check =
      previous.first_check == null
        ? row.first_check || null
        : row.first_check == null
          ? previous.first_check
          : Math.min(Number(previous.first_check), Number(row.first_check));
  }
  const rows = [...combined.values()].sort((left, right) => String(left.day).localeCompare(String(right.day)));
  const byDay = new Map();
  const byComponent = {};
  rows.forEach((row) => {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day).push(row);
    if (!byComponent[row.component_key]) byComponent[row.component_key] = {};
    byComponent[row.component_key][row.day] = row;
  });
  const daysOut = [];
  for (let i = boundedDays - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const entries = byDay.get(date) || [];
    const total = entries.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
    const successful = entries.reduce((sum, entry) => sum + Number(entry.successful || 0), 0);
    const hasWebsiteFailure = entries.some(
      (entry) => entry.component_key === 'website' && Number(entry.successful) < Number(entry.total)
    );
    const hasFailure = entries.some((entry) => Number(entry.successful) < Number(entry.total));
    const hasDegraded = entries.some((entry) => Number(entry.degraded) > 0);
    daysOut.push({
      date,
      status: hasWebsiteFailure
        ? 'major'
        : hasFailure
          ? 'partial'
          : hasDegraded
            ? 'degraded'
            : total
              ? 'operational'
              : 'unknown',
      availability: total ? Math.round((successful / total) * 10000) / 100 : null,
      checks: total,
      failedChecks: total - successful,
    });
  }
  return { days: daysOut, components: byComponent, startedAt: rows[0]?.first_check || null };
}

async function publicSnapshot() {
  await db.ready;
  const meta = await getMeta();
  const heartbeat = getHeartbeatHealth(meta);
  const catalog = await getComponentDefinitionsFromDb();
  const maintenance = await getActiveMaintenance();
  const scheduledMaintenance = await getUpcomingMaintenance();
  const rawComponents = [];
  for (const component of catalog) {
    const [latest, boundaries] = await Promise.all([latestCheck(component.key), checkBoundaries(component.key)]);
    const incident = await activeIncident(component.key);
    const flapping = isFlapping(await getRecentFinalOutcomes(component.key, 8));
    rawComponents.push({
      key: component.key,
      name: component.name,
      description: component.description,
      group: component.group,
      userImpact: component.userImpact !== false,
      status: componentStatus(component, latest, incident, maintenanceAffects(maintenance, component.key), flapping),
      flapping,
      responseMs: latest?.response_ms ?? null,
      lastCheck: latest?.checked_at || null,
      lastSuccess: boundaries?.last_success || null,
      lastFailure: boundaries?.last_failure || null,
      incident: incident
        ? {
            publicId: incident.public_id,
            title: incident.title,
            severity: incident.severity,
            status: incident.status,
            startedAt: incident.started_at,
            summary: incident.public_summary,
          }
        : null,
      uptime: {
        day: await uptimeFor(component.key, 1),
        week: await uptimeFor(component.key, 7),
        month: await uptimeFor(component.key, 30),
      },
    });
  }
  const incidents = rawComponents
    .filter((component) => component.incident)
    .map((component) => ({
      ...component.incident,
      componentKey: component.key,
      componentName: component.name,
      userImpact: component.userImpact,
    }));
  const watchdogIncident = await activeIncident('monitoring-worker');
  if (!heartbeat.healthy) {
    incidents.unshift({
      publicId: watchdogIncident?.public_id || 'MONITORING-WORKER-STALE',
      title: watchdogIncident?.title || 'Monitoring worker heartbeat stale',
      severity: watchdogIncident?.severity || 'SEV-2 / Major',
      status: watchdogIncident?.status || 'identified',
      startedAt: watchdogIncident?.started_at || Number(meta.heartbeat_watchdog_checked_at || unixNow()),
      summary: 'The independent monitoring worker has not completed a cycle within the expected interval.',
      componentKey: 'monitoring-worker',
      componentName: 'Monitoring worker',
    });
  }
  const history = await dailyHistory(90);
  return {
    overall: overallStatus(rawComponents, incidents, maintenance),
    components: rawComponents,
    incidents,
    previousIncidents: (await publicIncidents(20)).filter((incident) => incident.status === 'resolved'),
    maintenance: maintenance.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      startsAt: entry.starts_at,
      endsAt: entry.ends_at,
      affectedComponents: entry.affected_components,
    })),
    scheduledMaintenance: scheduledMaintenance.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      startsAt: entry.starts_at,
      endsAt: entry.ends_at,
      affectedComponents: entry.affected_components,
    })),
    history,
    heartbeat: {
      lastCycleAt: asNumber(meta.last_cycle_at),
      nextCycleAt: asNumber(meta.next_cycle_at),
      status: heartbeat.status,
      healthy: heartbeat.healthy,
      ageSeconds: heartbeat.ageSeconds,
      maxAgeSeconds: heartbeat.maxAgeSeconds,
      intervalMs: STATUS_CHECK_INTERVAL_MS,
    },
    coverageStartedAt: history.startedAt,
    statusPageUrl: getStatusPublicUrl(),
  };
}

async function adminOverview() {
  const snapshot = await publicSnapshot();
  const checks = await db
    .prepare(
      `SELECT id, cycle_id, component_key, checked_at, attempt, endpoint, check_type,
              success, state, status_code, response_ms, error_message, timed_out,
              final_result, incident_id, metadata_json
       FROM status_checks ORDER BY checked_at DESC, id DESC LIMIT 250`
    )
    .all();
  const incidents = await db.prepare('SELECT * FROM status_incidents ORDER BY started_at DESC LIMIT 100').all();
  const updates = await db
    .prepare(
      'SELECT * FROM status_incident_updates WHERE incident_id IN (SELECT id FROM status_incidents ORDER BY started_at DESC LIMIT 100) ORDER BY created_at ASC'
    )
    .all();
  const deliveries = await db
    .prepare('SELECT * FROM status_notification_deliveries ORDER BY updated_at DESC LIMIT 250')
    .all();
  const recipients = await db
    .prepare('SELECT email, active, source, created_at, updated_at FROM status_alert_recipients ORDER BY email ASC')
    .all();
  const maintenance = await db.prepare('SELECT * FROM status_maintenance ORDER BY starts_at DESC LIMIT 50').all();
  return {
    snapshot,
    checks,
    incidents,
    updates,
    deliveries,
    recipients,
    maintenance,
    meta: await getMeta(),
    adminEmail: ADMIN_EMAIL || null,
  };
}

function maintenanceAffects(maintenance, key) {
  return maintenance.some(
    (entry) =>
      parseAffected(entry.affected_components).includes('*') || parseAffected(entry.affected_components).includes(key)
  );
}

function pageCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

function renderPage(admin, pageNonce) {
  const nonce = pageNonce || crypto.randomBytes(16).toString('base64');
  const adminFlag = admin ? 'true' : 'false';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Capital Flow system status and incident history">
<title>${admin ? 'Status Operations — Capital Flow' : 'Capital Flow Status'}</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#0b0b0c;--surface:#121214;--surface2:#18181b;--surface3:#202024;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.14);--text:#f0f0f1;--muted:#8f8f98;--faint:#62626c;--gold:#f59e0b;--gold2:#fbbf24;--green:#22c55e;--red:#ef4444;--orange:#f97316;--cyan:#22d3ee;--shadow:0 22px 60px rgba(0,0,0,.28);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text)}body{overflow-x:hidden}a{color:inherit}.status-shell{width:min(1080px,calc(100% - 40px));margin:0 auto;padding:22px 0 70px}.status-nav{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:4px 0 26px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:11px;text-decoration:none}.brand img{width:34px;height:34px;object-fit:cover;border-radius:50%;border:1px solid rgba(245,158,11,.32)}.brand strong{font-size:15px;letter-spacing:.12em}.brand span{display:block;color:var(--muted);font-size:11px;margin-top:2px;letter-spacing:.12em;text-transform:uppercase}.nav-actions{display:flex;align-items:center;gap:8px}.nav-link,.button{border:1px solid var(--line2);background:transparent;color:var(--muted);border-radius:7px;padding:8px 12px;font-size:12px;text-decoration:none;cursor:pointer}.nav-link:hover,.button:hover{color:var(--text);border-color:rgba(245,158,11,.55)}.hero{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:30px;padding:56px 0 40px}.eyebrow{color:var(--gold);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:16px}.hero h1{margin:0;font-size:clamp(30px,5vw,54px);line-height:1.03;letter-spacing:-.045em;max-width:670px}.hero-copy{color:var(--muted);font-size:14px;line-height:1.7;max-width:620px;margin:16px 0 0}.hero-status{text-align:right;min-width:180px}.status-dot{display:inline-flex;align-items:center;gap:8px;color:var(--green);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;letter-spacing:.04em}.status-dot:before{content:"";width:9px;height:9px;border-radius:50%;background:currentColor;box-shadow:0 0 0 5px color-mix(in srgb,currentColor 14%,transparent)}.status-dot.warn{color:var(--gold2)}.status-dot.down{color:var(--red)}.status-dot.partial{color:var(--orange)}.status-dot.maintenance{color:var(--cyan)}.status-dot.unknown{color:var(--faint)}.last-check{color:var(--faint);font-size:11px;margin-top:13px}.notice{display:none;border:1px solid rgba(239,68,68,.34);background:rgba(239,68,68,.08);border-radius:8px;padding:15px 17px;margin:0 0 24px}.notice.show{display:block}.notice strong{font-size:13px}.notice p{color:#c9a6a6;font-size:12px;line-height:1.55;margin:6px 0 0}.section{margin-top:28px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:12px}.section-head h2{font-size:15px;letter-spacing:-.01em;margin:0}.section-head p{margin:0;color:var(--faint);font-size:11px}.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow)}.component-list{overflow:hidden}.component{display:grid;grid-template-columns:minmax(190px,1.1fr) 150px 100px 112px;gap:20px;align-items:center;padding:17px 19px;border-bottom:1px solid var(--line)}.component:last-child{border-bottom:0}.component-main{min-width:0}.component-name{font-size:13px;font-weight:650}.component-description{color:var(--muted);font-size:11px;line-height:1.45;margin-top:4px}.component-status{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}.component-status.ok{color:var(--green)}.component-status.warn{color:var(--gold2)}.component-status.partial{color:var(--orange)}.component-status.down{color:var(--red)}.component-status.maintenance{color:var(--cyan)}.component-status.unknown{color:var(--faint)}.metric{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);font-size:11px}.metric b{display:block;color:var(--text);font-size:12px;font-weight:500;margin-bottom:4px}.component details{grid-column:1/-1;border-top:1px solid var(--line);padding-top:11px;color:var(--muted);font-size:11px}.component summary{cursor:pointer;color:var(--faint);list-style:none}.component summary::-webkit-details-marker{display:none}.component summary:after{content:" +";color:var(--gold)}.component details[open] summary:after{content:" −"}.detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:11px}.detail-cell{background:var(--surface2);border:1px solid var(--line);border-radius:7px;padding:10px}.detail-cell span{display:block;color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}.detail-cell b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--text);font-size:12px;font-weight:500}.history-wrap{padding:18px 19px}.history-bars{display:grid;grid-template-columns:repeat(90,minmax(4px,1fr));gap:3px;align-items:end;min-height:48px}.history-bar{height:34px;min-width:3px;background:var(--surface3);border-radius:2px;cursor:pointer;position:relative}.history-bar:hover{filter:brightness(1.35)}.history-bar.operational{background:rgba(34,197,94,.82)}.history-bar.degraded{background:rgba(245,158,11,.86)}.history-bar.partial{background:rgba(249,115,22,.9)}.history-bar.major{background:rgba(239,68,68,.92)}.history-bar.maintenance{background:rgba(34,211,238,.82)}.history-bar:focus-visible{outline:2px solid var(--gold);outline-offset:3px}.history-axis{display:flex;justify-content:space-between;color:var(--faint);font:10px ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:11px}.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:17px;color:var(--muted);font-size:11px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:9px;height:9px;border-radius:2px;background:var(--surface3)}.legend .operational{background:var(--green)}.legend .degraded{background:var(--gold2)}.legend .partial{background:var(--orange)}.legend .major{background:var(--red)}.legend .maintenance{background:var(--cyan)}.day-detail{display:none;border-top:1px solid var(--line);margin-top:17px;padding-top:15px;color:var(--muted);font-size:12px;line-height:1.55}.day-detail.show{display:block}.incident{padding:18px 19px;border-bottom:1px solid var(--line)}.incident:last-child{border-bottom:0}.incident-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.incident-title{font-size:13px;font-weight:650}.incident-meta{color:var(--faint);font:10px ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:5px}.incident-summary{color:var(--muted);font-size:12px;line-height:1.55;margin-top:10px}.pill{display:inline-flex;border-radius:999px;padding:4px 8px;font:10px ui-monospace,SFMono-Regular,Consolas,monospace;border:1px solid var(--line2);color:var(--muted);white-space:nowrap}.pill.live{color:var(--red);border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.08)}.pill.resolved{color:var(--green);border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.07)}.incident-update{display:flex;gap:10px;margin-top:10px;color:var(--muted);font-size:11px}.incident-update b{color:var(--text);font-weight:500}.empty{padding:27px 19px;color:var(--faint);font-size:12px}.footer{display:flex;justify-content:space-between;gap:15px;border-top:1px solid var(--line);margin-top:46px;padding-top:19px;color:var(--faint);font-size:10px;line-height:1.6}.admin-area{display:none;margin-top:36px}.admin-area.show{display:block}.admin-panel{padding:18px 19px;margin-bottom:15px}.admin-panel h3{margin:0;font-size:13px}.admin-panel p{color:var(--muted);font-size:11px;line-height:1.5;margin:6px 0 14px}.admin-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.admin-input,.admin-select,.admin-textarea{background:var(--surface2);border:1px solid var(--line2);border-radius:6px;color:var(--text);font:12px ui-monospace,SFMono-Regular,Consolas,monospace;padding:8px 10px}.admin-input{min-width:210px}.admin-select{min-width:130px}.admin-textarea{width:100%;min-height:70px;resize:vertical;font-family:inherit}.admin-button{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.38);color:var(--gold2);border-radius:6px;padding:8px 11px;font-size:11px;font-weight:650;cursor:pointer}.admin-button.secondary{background:transparent;color:var(--muted);border-color:var(--line2)}.admin-button.danger{background:rgba(239,68,68,.1);color:#fca5a5;border-color:rgba(239,68,68,.35)}.admin-table-wrap{overflow:auto}.admin-table{width:100%;border-collapse:collapse;min-width:700px;font-size:11px}.admin-table th{color:var(--faint);font:10px ui-monospace,SFMono-Regular,Consolas,monospace;text-align:left;text-transform:uppercase;letter-spacing:.07em;padding:9px;border-bottom:1px solid var(--line)}.admin-table td{color:var(--muted);padding:10px 9px;border-bottom:1px solid var(--line);vertical-align:top}.admin-table td strong{color:var(--text);font-weight:500}.admin-table code{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;color:#d4d4d8;white-space:pre-wrap;word-break:break-word}.admin-help{color:var(--faint);font-size:11px}.admin-auth{display:flex;gap:8px;align-items:center}.admin-auth input{flex:1}.admin-only{display:none}.admin-only.show{display:block}.maintenance-form{display:grid;grid-template-columns:1fr 1fr;gap:8px}.maintenance-form .wide{grid-column:1/-1}.toast{position:fixed;right:18px;bottom:18px;z-index:4;background:var(--surface3);border:1px solid var(--line2);border-radius:7px;color:var(--text);padding:10px 13px;font-size:12px;box-shadow:var(--shadow);opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s}.toast.show{opacity:1;transform:translateY(0)}@media(max-width:760px){.status-shell{width:min(100% - 24px,680px);padding-top:14px}.status-nav{padding-bottom:18px}.hero{grid-template-columns:1fr;padding:38px 0 28px;gap:20px}.hero-status{text-align:left}.component{grid-template-columns:minmax(0,1fr) auto;gap:12px}.component .metric:nth-of-type(2){display:none}.component .metric:nth-of-type(1){text-align:right}.component-status{grid-column:2;grid-row:1}.component-main{grid-column:1;grid-row:1}.component details{grid-column:1/-1}.history-bars{grid-template-columns:repeat(90,minmax(2px,1fr));gap:2px}.history-wrap{padding:14px 12px}.footer{display:block}.footer span{display:block;margin-top:5px}.maintenance-form{grid-template-columns:1fr}.maintenance-form .wide{grid-column:auto}}@media(max-width:430px){.brand strong{font-size:13px}.nav-link,.button{padding:7px 9px;font-size:11px}.hero h1{font-size:33px}.detail-grid{grid-template-columns:1fr 1fr}.component{padding:15px 13px}.section-head{display:block}.section-head p{margin-top:5px}}
</style>
<style nonce="${nonce}">
.refresh-control{white-space:nowrap}
.refresh-control:disabled{opacity:.65;cursor:wait}
.admin-auth{flex-wrap:wrap}
.admin-button:disabled{opacity:.65;cursor:wait}
.history-bar{padding:0;border:0;appearance:none;min-width:0}
</style>
</head>
<body>
<div class="status-shell">
  <header class="status-nav">
  <a class="brand" href="/" aria-label="Capital Flow home"><img src="/logo-gold.jpeg" alt="Capital Flow logo"><div><strong>CAPITAL FLOW</strong><span>System status</span></div></a>
    <div class="nav-actions"><a class="nav-link" href="/status">Public status</a><a class="nav-link" href="/status/admin">Operations</a><button class="button refresh-control" id="refresh-status" type="button">Refresh status</button></div>
  </header>
  <main>
    <section class="hero" aria-labelledby="overall-title">
      <div><div class="eyebrow">LIVE SERVICE STATUS</div><h1 id="overall-title">Checking system status</h1><p class="hero-copy" id="overall-copy">We monitor the platform, critical workflows, dependencies and infrastructure automatically.</p></div>
      <div class="hero-status"><div id="overall-badge" class="status-dot unknown" role="status" aria-live="polite">Checking</div><div class="last-check" id="last-check">Last check —</div><div class="last-check" id="next-check">Next automatic check —</div><div class="last-check" id="page-updated">Page updated —</div></div>
    </section>
    <section class="notice" id="active-notice" aria-live="polite"><strong id="notice-title">Active incident</strong><p id="notice-copy"></p></section>
    <section class="section" id="scheduled-maintenance-section" aria-labelledby="scheduled-maintenance-title" style="display:none"><div class="section-head"><h2 id="scheduled-maintenance-title">Scheduled maintenance</h2><p>Planned work</p></div><div class="card" id="scheduled-maintenance"></div></section>
    <section class="section" aria-labelledby="services-title"><div class="section-head"><h2 id="services-title">Services and components</h2><p id="coverage-copy">Monitoring coverage is being established.</p></div><div class="card component-list" id="components"><div class="empty">Loading component status…</div></div></section>
    <section class="section" aria-labelledby="history-title"><div class="section-head"><h2 id="history-title">Availability history</h2><p>Daily status over the last 90 days</p></div><div class="card history-wrap"><div class="history-bars" id="history-bars" role="list" aria-label="Daily availability history"></div><div class="history-axis"><span>90 days ago</span><span>Today</span></div><div class="legend"><span><i class="operational"></i>Operational</span><span><i class="degraded"></i>Degraded</span><span><i class="partial"></i>Partial outage</span><span><i class="major"></i>Major outage</span><span><i class="maintenance"></i>Maintenance</span></div><div class="day-detail" id="day-detail"></div></div></section>
    <section class="section" aria-labelledby="active-incidents-title"><div class="section-head"><h2 id="active-incidents-title">Active incidents</h2><p>Confirmed incidents only</p></div><div class="card" id="active-incidents"><div class="empty">No active incidents.</div></div></section>
    <section class="section" aria-labelledby="previous-incidents-title"><div class="section-head"><h2 id="previous-incidents-title">Previous incidents</h2><p>Resolved incidents from monitoring history</p></div><div class="card" id="previous-incidents"><div class="empty">No incidents have been recorded yet.</div></div></section>
     <div class="admin-area${admin ? ' show' : ''}" id="admin-area">
      <section class="section"><div class="section-head"><h2>Operations console</h2><p>Private monitoring controls</p></div><div class="card admin-panel"><h3>Admin authentication</h3><p>Use the existing admin token or sign in as the configured administrator. A static token is stored in this tab only and is sent in a request header.</p><div class="admin-auth"><input class="admin-input" id="admin-token" type="password" autocomplete="off" placeholder="Static admin token"><button class="admin-button" id="save-token" type="button">Use token</button><button class="admin-button secondary" id="refresh-admin-page" type="button">Refresh admin</button><button class="admin-button secondary" id="check-now" type="button">Run check now</button><a class="nav-link" href="${getFullAdminUrl()}">Full user admin</a></div><div class="admin-help" id="admin-auth-status"></div></div></section>
      <section class="section admin-only" id="admin-controls"><div class="section-head"><h2>Monitoring controls</h2><p id="admin-meta">—</p></div><div class="card admin-panel"><div class="admin-toolbar"><button class="admin-button secondary" id="refresh-admin" type="button">Refresh diagnostics</button><span class="admin-help">Manual checks are rate-limited and never depend on this dashboard remaining open.</span></div></div><div class="card admin-panel"><h3>Scheduled maintenance</h3><p>Maintenance suppresses normal outage alerts only for the selected components and time window. The monitor continues recording checks.</p><form class="maintenance-form" id="maintenance-form"><input class="admin-input" name="title" required maxlength="120" placeholder="Maintenance title"><input class="admin-input" name="startsAt" required type="datetime-local"><input class="admin-input" name="endsAt" required type="datetime-local"><input class="admin-input" name="components" required placeholder="Components: website,backend or *"><textarea class="admin-textarea wide" name="description" required maxlength="1000" placeholder="What is changing and what users should expect?"></textarea><div class="wide"><button class="admin-button" type="submit">Schedule maintenance</button></div></form></div><div class="card admin-panel"><h3>Alert recipients</h3><p>Environment recipients are cached into the status store. Additional recipients can be managed here.</p><form class="admin-toolbar" id="recipient-form"><input class="admin-input" name="email" required type="email" placeholder="admin@example.com"><button class="admin-button" type="submit">Add recipient</button></form><div class="admin-table-wrap" id="recipients-table"><div class="empty">No recipients loaded.</div></div></div><div class="card admin-panel"><h3>Incidents and diagnostics</h3><div class="admin-table-wrap" id="admin-incidents"><div class="empty">Authenticate to load private diagnostics.</div></div></div><div class="card admin-panel"><h3>Recent monitoring checks</h3><div class="admin-table-wrap" id="admin-checks"><div class="empty">Authenticate to load private checks.</div></div></div><div class="card admin-panel"><h3>Maintenance history</h3><div class="admin-table-wrap" id="admin-maintenance"><div class="empty">Authenticate to load maintenance.</div></div></div></section>
    </div>
  </main>
  <footer class="footer"><span>Capital Flow status is updated automatically every 5 minutes.</span><span>Public information is sanitized; private diagnostics are available to authorized operators only.</span></footer>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function(){
  var ADMIN_PAGE=${adminFlag};
  var summary=null;
  var adminData=null;
  var tokenKey='capital-flow-admin-token';
  var statusLabels={operational:'Operational',degraded:'Degraded Performance',partial:'Partial Outage',major:'Major Outage',maintenance:'Maintenance',unknown:'Checking'};
  function byId(id){return document.getElementById(id)}
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>'"]/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]})}
  function fmtTime(value){if(!value)return '—';return new Date(Number(value)*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
  function fmtDate(value){if(!value)return '—';return new Date(Number(value)*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
  function fmtMs(value){return value==null?'—':Math.round(Number(value))+' ms'}
  function fmtUptime(value){return value==null?'—':Number(value).toFixed(2)+'%'}
  function statusClass(status){var map={operational:'ok',degraded:'warn',partial:'partial',major:'down',maintenance:'maintenance',unknown:'unknown'};return map[status]||'unknown'}
  function toast(message){var el=byId('toast');el.textContent=message;el.classList.add('show');setTimeout(function(){el.classList.remove('show')},2600)}
  function readSessionValue(key){try{return window.sessionStorage.getItem(key)||''}catch(error){return ''}}
  function writeSessionValue(key,value){try{window.sessionStorage.setItem(key,value)}catch(error){}}
  function authHeaders(){var headers={};var token=readSessionValue(tokenKey);var jwt=localStorage.getItem('vs_token');if(token)headers['x-admin-token']=token;else if(jwt)headers.Authorization='Bearer '+jwt;return headers}
  function jsonHeaders(){var headers=authHeaders();headers['Content-Type']='application/json';return headers}
  function renderBadge(status){var badge=byId('overall-badge');badge.className='status-dot '+statusClass(status);badge.textContent=statusLabels[status]||'Checking'}
  function renderComponent(component){
    var status=statusLabels[component.status]||'Checking';
    var uptime=component.uptime||{};
    var incident=component.incident;
    var incidentLine=incident?' · '+escapeHtml(incident.severity):'';
    return '<article class="component"><div class="component-main"><div class="component-name">'+escapeHtml(component.name)+'</div><div class="component-description">'+escapeHtml(component.description)+'</div></div><div class="component-status '+statusClass(component.status)+'">'+status+incidentLine+'</div><div class="metric"><b>'+fmtMs(component.responseMs)+'</b>Response time</div><div class="metric"><b>'+fmtTime(component.lastCheck)+'</b>Last check</div><details><summary>Component details</summary><div class="detail-grid"><div class="detail-cell"><span>24-hour availability</span><b>'+fmtUptime(uptime.day&&uptime.day.availability)+'</b></div><div class="detail-cell"><span>7-day availability</span><b>'+fmtUptime(uptime.week&&uptime.week.availability)+'</b></div><div class="detail-cell"><span>30-day availability</span><b>'+fmtUptime(uptime.month&&uptime.month.availability)+'</b></div><div class="detail-cell"><span>Last successful check</span><b>'+fmtTime(component.lastSuccess)+'</b></div><div class="detail-cell"><span>Last failed check</span><b>'+fmtTime(component.lastFailure)+'</b></div><div class="detail-cell"><span>Current incident</span><b>'+escapeHtml(incident?incident.publicId:'None')+'</b></div></div></details></article>';
  }
  function renderIncidents(target,items,active){
    if(!items||!items.length){target.innerHTML='<div class="empty">'+(active?'No active incidents.':'No incidents have been recorded yet.')+'</div>';return}
    target.innerHTML=items.map(function(item){var status=item.status==='resolved'?'resolved':'live';var name=item.componentName||item.component_name||item.componentKey||item.component_key||'System';var summaryText=item.summary||item.public_summary||'Monitoring is collecting more information.';var start=item.startedAt||item.started_at;var end=item.resolvedAt||item.resolved_at;var updates=(item.updates||[]).map(function(update){return '<div class="incident-update"><b>'+escapeHtml(update.status)+'</b><span>'+escapeHtml(update.message)+' · '+fmtTime(update.created_at)+'</span></div>'}).join('');return '<article class="incident"><div class="incident-head"><div><div class="incident-title">'+escapeHtml(item.title)+' <span class="pill '+status+'">'+(status==='resolved'?'Resolved':'Active')+'</span></div><div class="incident-meta">'+escapeHtml(name)+' · '+escapeHtml(item.severity||'')+' · '+fmtTime(start)+(end?' → '+fmtTime(end):'')+(item.outage_seconds?' · '+Math.round(item.outage_seconds/60)+' min':'')+'</div></div></div><div class="incident-summary">'+escapeHtml(summaryText)+'</div>'+updates+'</article>'}).join('');
  }
  function renderHistory(history){
    var bars=byId('history-bars');var days=(history&&history.days)||[];bars.innerHTML=days.map(function(day){var label=day.date+' · '+(day.availability==null?'No data':day.availability.toFixed(2)+'% available');return '<button class="history-bar '+statusClass(day.status)+'" type="button" role="listitem" aria-label="'+escapeHtml(label)+'" data-day="'+escapeHtml(day.date)+'" title="'+escapeHtml(label)+'"></button>'}).join('');
    Array.prototype.forEach.call(bars.querySelectorAll('[data-day]'),function(button){button.addEventListener('click',function(){var day=days.find(function(item){return item.date===button.dataset.day});var detail=byId('day-detail');if(!day){detail.classList.remove('show');return}detail.innerHTML='<strong>'+escapeHtml(day.date)+'</strong> · '+escapeHtml(statusLabels[day.status]||'No data')+' · Availability '+(day.availability==null?'No data':day.availability.toFixed(2)+'%')+' · '+day.checks+' checks · '+day.failedChecks+' failed checks.';detail.classList.add('show')})});
  }
  function renderScheduledMaintenance(items){var section=byId('scheduled-maintenance-section');var target=byId('scheduled-maintenance');if(!items||!items.length){section.style.display='none';target.innerHTML='';return}section.style.display='block';target.innerHTML=items.map(function(item){return '<article class="incident"><div class="incident-head"><div><div class="incident-title">'+escapeHtml(item.title)+'</div><div class="incident-meta">'+fmtTime(item.startsAt)+' → '+fmtTime(item.endsAt)+' · '+escapeHtml((item.affectedComponents||[]).join(', '))+'</div></div><span class="pill">Planned</span></div><div class="incident-summary">'+escapeHtml(item.description)+'</div></article>'}).join('')}
  function renderSummary(data){
    summary=data;var status=data.overall||'unknown';var major=status==='major';byId('overall-title').textContent=statusLabels[status]||'Checking system status';byId('overall-copy').textContent=major?'A major component is currently unavailable. We are investigating and will publish updates as the situation changes.':status==='partial'?'Some functionality is currently affected. Core monitoring remains online and the affected component is shown below.':status==='degraded'?'The platform is available, but one or more components are slower than normal.':'We monitor the platform, critical workflows, dependencies and infrastructure automatically.';renderBadge(status);byId('last-check').textContent='Last check '+fmtTime(data.heartbeat&&data.heartbeat.lastCycleAt);byId('next-check').textContent='Next automatic check '+fmtTime(data.heartbeat&&data.heartbeat.nextCycleAt);var first=data.coverageStartedAt?'Monitoring since '+fmtDate(data.coverageStartedAt):'Monitoring coverage is being established.';byId('coverage-copy').textContent=first;byId('components').innerHTML=(data.components||[]).map(renderComponent).join('')||'<div class="empty">No component data yet.</div>';renderScheduledMaintenance(data.scheduledMaintenance||[]);renderHistory(data.history||{});renderIncidents(byId('active-incidents'),data.incidents||[],true);renderIncidents(byId('previous-incidents'),data.previousIncidents||[],false);var notice=byId('active-notice');if(data.incidents&&data.incidents.length){var incident=data.incidents[0];notice.classList.add('show');byId('notice-title').textContent=incident.title+' · '+incident.severity;byId('notice-copy').textContent=incident.summary+' Started '+fmtTime(incident.startedAt)+'. Incident '+incident.publicId+'.'}else{notice.classList.remove('show')}}
  async function loadSummary(){try{var response=await fetch('/status/api/summary',{cache:'no-store'});var data=await response.json();renderSummary(data)}catch(error){renderBadge('unknown');byId('overall-title').textContent='Status data temporarily unavailable';byId('overall-copy').textContent='The status page is online, but the latest monitoring snapshot could not be loaded.'}}
  function renderAdmin(data){
    adminData=data;byId('admin-controls').classList.add('show');byId('admin-auth-status').textContent='Authenticated as '+(data.adminEmail||'static admin token');byId('admin-meta').textContent='Heartbeat '+fmtTime(data.meta&&data.meta.heartbeat_at)+' · Last cycle '+fmtTime(data.meta&&data.meta.last_cycle_at);var recipients=data.recipients||[];byId('recipients-table').innerHTML=recipients.length?'<table class="admin-table"><thead><tr><th>Email</th><th>Source</th><th>Status</th><th>Action</th></tr></thead><tbody>'+recipients.map(function(item){return '<tr><td><strong>'+escapeHtml(item.email)+'</strong></td><td>'+escapeHtml(item.source)+'</td><td>'+ (item.active?'Active':'Disabled')+'</td><td><button class="admin-button danger" data-remove-recipient="'+encodeURIComponent(item.email)+'" type="button">Remove</button></td></tr>'}).join('')+'</tbody></table>':'<div class="empty">No recipients configured.</div>';
    var incidents=data.incidents||[];byId('admin-incidents').innerHTML=incidents.length?'<table class="admin-table"><thead><tr><th>Incident</th><th>Status</th><th>Private error</th><th>Actions</th></tr></thead><tbody>'+incidents.map(function(item){return '<tr><td><strong>'+escapeHtml(item.public_id)+'</strong><br>'+escapeHtml(item.title)+'<br>'+fmtTime(item.started_at)+'</td><td>'+escapeHtml(item.status)+'<br>'+escapeHtml(item.severity)+'</td><td><code>'+escapeHtml(item.error_message||'—')+'</code></td><td><button class="admin-button secondary" data-update-incident="'+item.id+'" type="button">Add update</button> '+(item.status==='resolved'?'':'<button class="admin-button danger" data-resolve-incident="'+item.id+'" type="button">Resolve</button>')+'</td></tr>'}).join('')+'</tbody></table>':'<div class="empty">No incidents.</div>';
    var checks=data.checks||[];byId('admin-checks').innerHTML=checks.length?'<table class="admin-table"><thead><tr><th>Time</th><th>Component</th><th>Result</th><th>HTTP</th><th>Latency</th><th>Diagnostic</th></tr></thead><tbody>'+checks.slice(0,120).map(function(item){return '<tr><td>'+fmtTime(item.checked_at)+'<br>attempt '+item.attempt+(item.final_result?' · final':'')+'</td><td><strong>'+escapeHtml(item.component_key)+'</strong><br>'+escapeHtml(item.check_type)+'</td><td>'+ (item.success?'Success':'Failed')+'<br>'+escapeHtml(item.state)+'</td><td>'+escapeHtml(item.status_code==null?'—':item.status_code)+'</td><td>'+fmtMs(item.response_ms)+'</td><td><code>'+escapeHtml(item.error_message||'—')+'</code></td></tr>'}).join('')+'</tbody></table>':'<div class="empty">No checks yet.</div>';
    var maintenance=data.maintenance||[];byId('admin-maintenance').innerHTML=maintenance.length?'<table class="admin-table"><thead><tr><th>Title</th><th>Window</th><th>Components</th><th>Action</th></tr></thead><tbody>'+maintenance.map(function(item){return '<tr><td><strong>'+escapeHtml(item.title)+'</strong><br>'+escapeHtml(item.description)+'</td><td>'+fmtTime(item.starts_at)+' → '+fmtTime(item.ends_at)+'</td><td>'+escapeHtml(String(item.affected_components))+'</td><td><button class="admin-button danger" data-delete-maintenance="'+item.id+'" type="button">Delete</button></td></tr>'}).join('')+'</tbody></table>':'<div class="empty">No maintenance windows.</div>';
  }
  async function runStatusBackup(){try{var result=await adminRequest('/status/api/admin/backup/run-now',{method:'POST'});toast('Status backup sent: '+((result.backup&&result.backup.filename)||'complete'));loadAdmin()}catch(error){toast(error.message)}}
  function installBackupButton(){var toolbar=byId('admin-controls')&&byId('admin-controls').querySelector('.admin-toolbar');if(!toolbar||byId('run-status-backup'))return;var button=document.createElement('button');button.id='run-status-backup';button.className='admin-button secondary';button.type='button';button.textContent='Backup status DB';button.addEventListener('click',runStatusBackup);toolbar.appendChild(button)}
  var adminControls=byId('admin-controls');if(adminControls&&window.MutationObserver){new MutationObserver(installBackupButton).observe(adminControls,{childList:true,subtree:true})}
  async function loadAdmin(){if(!ADMIN_PAGE)return;try{var response=await fetch('/status/api/admin/overview',{headers:authHeaders(),cache:'no-store'});if(!response.ok){byId('admin-auth-status').textContent=response.status===401?'Enter an admin token or sign in as the configured admin.':'Admin access is not configured.';byId('admin-controls').classList.remove('show');return}renderAdmin(await response.json());installBackupButton()}catch(error){byId('admin-auth-status').textContent='Could not load private diagnostics.'}}
  async function adminRequest(url,options){var response=await fetch(url,Object.assign({},options||{}, {headers:Object.assign({},jsonHeaders(),(options&&options.headers)||{})}));var data=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(data.error||'Request failed');return data}
  byId('save-token').addEventListener('click',function(){var value=byId('admin-token').value.trim();if(value)writeSessionValue(tokenKey,value);loadAdmin()});
  byId('check-now').addEventListener('click',async function(){try{await adminRequest('/status/api/admin/check-now',{method:'POST'});toast('Monitoring cycle started');setTimeout(function(){loadSummary();loadAdmin()},1200)}catch(error){toast(error.message)}});
  async function refreshAdminView(button){var label=button&&button.textContent;if(button){button.disabled=true;button.textContent='Refreshing…'}try{await Promise.all([loadAdmin(),loadSummary()]);markPageUpdated();toast('Admin refreshed')}finally{if(button){button.disabled=false;button.textContent=label}}}
  byId('refresh-admin').addEventListener('click',function(){refreshAdminView(this)});
  byId('refresh-admin-page').addEventListener('click',function(){refreshAdminView(this)});
  byId('maintenance-form').addEventListener('submit',async function(event){event.preventDefault();var form=new FormData(event.target);try{await adminRequest('/status/api/admin/maintenance',{method:'POST',body:JSON.stringify({title:form.get('title'),description:form.get('description'),startsAt:form.get('startsAt'),endsAt:form.get('endsAt'),affectedComponents:String(form.get('components')).split(',').map(function(value){return value.trim()}).filter(Boolean)})});event.target.reset();toast('Maintenance scheduled');loadSummary();loadAdmin()}catch(error){toast(error.message)}});
  byId('recipient-form').addEventListener('submit',async function(event){event.preventDefault();var form=new FormData(event.target);try{await adminRequest('/status/api/admin/recipients',{method:'POST',body:JSON.stringify({email:form.get('email')})});event.target.reset();toast('Recipient added');loadAdmin()}catch(error){toast(error.message)}});
  document.addEventListener('click',async function(event){var remove=event.target.closest('[data-remove-recipient]');if(remove){try{await adminRequest('/status/api/admin/recipients/'+remove.dataset.removeRecipient,{method:'DELETE'});toast('Recipient removed');loadAdmin()}catch(error){toast(error.message)}return}var del=event.target.closest('[data-delete-maintenance]');if(del){try{await adminRequest('/status/api/admin/maintenance/'+del.dataset.deleteMaintenance,{method:'DELETE'});toast('Maintenance deleted');loadSummary();loadAdmin()}catch(error){toast(error.message)}return}var resolve=event.target.closest('[data-resolve-incident]');if(resolve){var note=window.prompt('Public resolution note','The incident was resolved manually by an operator.');if(note===null)return;try{await adminRequest('/status/api/admin/incidents/'+resolve.dataset.resolveIncident+'/resolve',{method:'POST',body:JSON.stringify({message:note})});toast('Incident resolved');loadSummary();loadAdmin()}catch(error){toast(error.message)}return}var update=event.target.closest('[data-update-incident]');if(update){var message=window.prompt('Incident update');if(!message)return;try{await adminRequest('/status/api/admin/incidents/'+update.dataset.updateIncident+'/update',{method:'POST',body:JSON.stringify({message:message,status:'identified',isPublic:true})});toast('Incident updated');loadSummary();loadAdmin()}catch(error){toast(error.message)}}});
  function markPageUpdated(){var updated=byId('page-updated');if(updated)updated.textContent='Page updated '+new Date().toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
  byId('refresh-status').addEventListener('click',function(){var button=byId('refresh-status');button.disabled=true;button.textContent='Refreshing…';loadSummary().then(function(){markPageUpdated();toast('Status refreshed')}).finally(function(){button.disabled=false;button.textContent='Refresh status'})});
  loadSummary().then(markPageUpdated);loadAdmin();setInterval(function(){loadSummary().then(markPageUpdated)},60000);if(ADMIN_PAGE)setInterval(loadAdmin,60000);
})();
</script>
</body>
</html>`;
}

router.get('/status', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', pageCsp(nonce));
  res.send(renderPage(false, nonce));
});

router.get('/status/admin', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', pageCsp(nonce));
  res.send(renderPage(true, nonce));
});

router.get(
  '/status/api/summary',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await publicSnapshot());
    } catch (err) {
      reportError(err, '[status public snapshot]');
      res.json({
        overall: 'unknown',
        components: [],
        incidents: [],
        previousIncidents: [],
        maintenance: [],
        history: { days: [], components: {}, startedAt: null },
        heartbeat: { lastCycleAt: null, nextCycleAt: null, intervalMs: STATUS_CHECK_INTERVAL_MS, status: 'error' },
        statusPageUrl: getStatusPublicUrl(),
      });
    }
  })
);

router.get(
  '/status/api/history',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await dailyHistory(req.query.days || 90));
  })
);

router.get(
  '/status/internal/market-data',
  asyncRoute(async (req, res) => {
    if (!STATUS_INTERNAL_TOKEN) return res.status(503).json({ error: 'Internal market-data probe is not configured.' });
    if (STATUS_INTERNAL_TOKEN && req.headers['x-status-check-token'] !== STATUS_INTERNAL_TOKEN)
      return res.status(401).json({ error: 'Unauthorized' });
    try {
      const yahooFinance = require('../services/yahoo');
      const quote = await yahooFinance.quote('AAPL');
      const row = Array.isArray(quote) ? quote[0] : quote;
      if (!row || !row.symbol) return res.status(503).json({ ok: false, error: 'No sample data' });
      res.json({
        ok: true,
        provider: 'Yahoo Finance',
        sample: { symbol: row.symbol, price: row.regularMarketPrice || row.postMarketPrice || null },
      });
    } catch (err) {
      reportError(err, '[status market-data probe]');
      res.status(503).json({ ok: false, error: 'Market data unavailable' });
    }
  })
);

router.get(
  '/status/api/admin/overview',
  asyncRoute(async (req, res) => {
    if (!(await checkAdminToken(req, res))) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await adminOverview());
  })
);

router.post(
  '/status/api/admin/check-now',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    runStatusCycle().catch((err) => reportError(err, '[status manual cycle]'));
    res.status(202).json({ ok: true, message: 'Monitoring cycle started.' });
  })
);

router.post(
  '/status/api/admin/backup/run-now',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const result = await runStatusBackup();
    if (result.status !== 'success') {
      return res.status(503).json({ error: 'Status database backups are disabled.' });
    }
    res.json({
      ok: true,
      actor,
      backup: { filename: result.filename, bytes: result.bytes, recipients: result.recipients },
    });
  })
);

router.post(
  '/status/api/admin/components/:key/toggle',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const value = req.body && (req.body.enabled === true || req.body.enabled === 1 || req.body.enabled === '1') ? 1 : 0;
    const result = await db
      .prepare('UPDATE status_components SET enabled = ?, updated_at = ? WHERE component_key = ?')
      .run(value, unixNow(), req.params.key);
    if (!result || !result.rowsAffected) return res.status(404).json({ error: 'Unknown component.' });
    res.json({ ok: true, component: req.params.key, enabled: !!value });
  })
);

router.post(
  '/status/api/admin/maintenance',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const affected = Array.isArray(body.affectedComponents)
      ? body.affectedComponents.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const startsAt = Math.floor(new Date(body.startsAt).getTime() / 1000);
    const endsAt = Math.floor(new Date(body.endsAt).getTime() / 1000);
    if (
      !title ||
      !description ||
      !affected.length ||
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      endsAt <= startsAt
    )
      return res.status(400).json({ error: 'Valid title, description, components and time window are required.' });
    if (endsAt - startsAt > 90 * 86400)
      return res.status(400).json({ error: 'Maintenance windows cannot exceed 90 days.' });
    await db
      .prepare(
        'INSERT INTO status_maintenance (title, description, starts_at, ends_at, affected_components, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(title.slice(0, 120), description.slice(0, 1000), startsAt, endsAt, JSON.stringify(affected), actor);
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/status/api/admin/maintenance/:id',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    await db.prepare('DELETE FROM status_maintenance WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

router.post(
  '/status/api/admin/incidents/:id/update',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const message = String(req.body?.message || '').trim();
    const status = ['investigating', 'identified', 'monitoring'].includes(req.body?.status)
      ? req.body.status
      : 'identified';
    if (!message || message.length > 2000)
      return res.status(400).json({ error: 'Incident update must contain 1-2000 characters.' });
    const incident = await db.prepare('SELECT id FROM status_incidents WHERE id = ?').get(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    await db
      .prepare("UPDATE status_incidents SET status = ?, updated_at = ? WHERE id = ? AND status != 'resolved'")
      .run(status, unixNow(), incident.id);
    await db
      .prepare('INSERT INTO status_incident_updates (incident_id, status, message, is_public) VALUES (?, ?, ?, ?)')
      .run(incident.id, status, message, req.body?.isPublic === false ? 0 : 1);
    res.json({ ok: true, actor });
  })
);

router.post(
  '/status/api/admin/incidents/:id/resolve',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const incident = await db.prepare('SELECT * FROM status_incidents WHERE id = ?').get(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (incident.status === 'resolved') return res.json({ ok: true, alreadyResolved: true });
    const resolvedAt = unixNow();
    await db
      .prepare(
        "UPDATE status_incidents SET status = 'resolved', resolved_at = ?, outage_seconds = MAX(0, ? - started_at), updated_at = ? WHERE id = ?"
      )
      .run(resolvedAt, resolvedAt, resolvedAt, incident.id);
    const message = String(req.body?.message || 'The incident was resolved manually by an authorized operator.')
      .trim()
      .slice(0, 2000);
    await db
      .prepare(
        "INSERT INTO status_incident_updates (incident_id, status, message, is_public) VALUES (?, 'Resolved', ?, 1)"
      )
      .run(incident.id, message);
    res.json({ ok: true, actor });
  })
);

router.post(
  '/status/api/admin/recipients',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Enter a valid email address.' });
    await db
      .prepare(
        "INSERT INTO status_alert_recipients (email, active, source, updated_at) VALUES (?, 1, 'admin', ?) ON CONFLICT(email) DO UPDATE SET active = 1, updated_at = excluded.updated_at"
      )
      .run(email, unixNow());
    res.status(201).json({ ok: true, actor });
  })
);

router.delete(
  '/status/api/admin/recipients/:email',
  asyncRoute(async (req, res) => {
    const actor = await checkAdminToken(req, res);
    if (!actor) return;
    const email = decodeURIComponent(req.params.email).toLowerCase();
    if (ADMIN_EMAIL && email === ADMIN_EMAIL.toLowerCase())
      return res.status(400).json({ error: 'The configured primary admin recipient cannot be removed here.' });
    await db
      .prepare('UPDATE status_alert_recipients SET active = 0, updated_at = ? WHERE email = ?')
      .run(unixNow(), email);
    res.json({ ok: true, actor });
  })
);

module.exports = router;
