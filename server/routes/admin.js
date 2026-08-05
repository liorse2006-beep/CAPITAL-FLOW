const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { ADMIN_TOKEN, ADMIN_EMAIL, TURSO_DB_URL } = require('../config');
const { revokeAllSessions } = require('../services/auth');
const { reportError } = require('../utils/reportError');

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const DB_ENV = TURSO_DB_URL ? 'PRODUCTION (Turso)' : 'LOCAL (SQLite)';
const { resolveToken } = require('../middleware/authMiddleware');

// Catches unhandled promise rejections in async route handlers (Express 4 doesn't do this natively)
function asyncRoute(fn) {
  return function (req, res, next) {
    fn(req, res, next).catch(function (err) {
      reportError(err, '[admin route]');
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    });
  };
}

// Returns the acting admin's identity string on success (the ADMIN_EMAIL, or
// 'static-token' when authenticated via ADMIN_TOKEN instead of a login), or
// false on failure. Every existing call site already does
// `if (!(await checkToken(req, res))) return;`, which still works unchanged
// since a non-empty string is truthy — callers that need to attribute an
// audit-log entry just capture the returned identity instead of discarding it.
async function checkToken(req, res) {
  if (!ADMIN_TOKEN && !ADMIN_EMAIL) {
    res.status(503).send('Admin panel disabled — set ADMIN_TOKEN or ADMIN_EMAIL in .env');
    return false;
  }

  // Credentials are accepted only in headers. Query-string credentials leak
  // into browser history, reverse-proxy logs and monitoring systems.
  const tok = req.headers['x-admin-token'];
  if (tok && ADMIN_TOKEN && timingSafeStringEqual(tok, ADMIN_TOKEN)) return 'static-token';

  // Accept a current JWT belonging to the configured admin account. resolveToken
  // also enforces session_version, blocked status and expiry.
  const auth = req.headers.authorization || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (jwt && ADMIN_EMAIL) {
    const user = await resolveToken(jwt);
    if (user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return user.email;
  }

  res.status(401).send('Unauthorized');
  return false;
}

// Best-effort — an audit-log write failure should never block the action it's
// describing from succeeding.
async function logAction(actor, action, targetUserId, detail) {
  try {
    await db
      .prepare('INSERT INTO admin_audit_log (actor, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
      .run(actor, action, targetUserId || null, detail || null);
  } catch (err) {
    reportError(err, '[admin audit log]');
  }
}

// ── Admin API: user list ───────────────────────────────────────────────────
router.get('/admin/api/users', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const users = await db
    .prepare(
      `SELECT id, email, google_email, is_verified, is_premium, is_blocked, is_pilot, tier,
              pilot_terms_accepted_at, free_scan_count, created_at, last_login_at, notification_time,
              free_scan_used_capital_flow, free_scan_used_ma_scanner, free_scan_used_sector_moving,
              premium_scan_count, premium_scan_window_start,
              (SELECT COUNT(*) FROM watchlist_alerts    WHERE user_id = users.id) AS alert_count,
              (SELECT COUNT(*) FROM watchlist_alerts    WHERE user_id = users.id AND type = 'price') AS price_alert_count,
              (SELECT COUNT(*) FROM push_subscriptions  WHERE user_id = users.id) AS push_count
       FROM users ORDER BY id DESC`
    )
    .all();
  res.json(users);
}));

// ── Admin API: force sign-out ──────────────────────────────────────────────
router.post('/admin/api/users/:id/logout', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  // Deletes every row in user_sessions for this account — every device's
  // access token is checked against this table on its very next request
  // (see authMiddleware.resolveToken), so this takes effect immediately,
  // not just once each device's token happens to hit its own 1h expiry.
  await revokeAllSessions(req.params.id);
  logAction(actor, 'force_logout', req.params.id);
  res.json({ ok: true });
}));

const VALID_TIERS = new Set(['free', 'premium', 'elite']);

// ── Admin API: set subscription tier ───────────────────────────────────────
router.post('/admin/api/users/:id/tier', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const { tier } = req.body;
  if (!VALID_TIERS.has(tier)) return res.status(400).json({ error: 'tier must be free, premium, or elite' });
  await db.prepare('UPDATE users SET tier = ?, is_premium = ? WHERE id = ?').run(
    tier,
    tier !== 'free' ? 1 : 0,
    req.params.id
  );
  logAction(actor, 'set_tier', req.params.id, tier);
  res.json({ ok: true, tier });
}));

// ── Admin API: block / unblock ────────────────────────────────────────────
router.post('/admin/api/users/:id/block', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const { value } = req.body; // 1 or 0
  await db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
  logAction(actor, value ? 'block_user' : 'unblock_user', req.params.id);
  res.json({ ok: true });
}));

// ── Admin API: delete user ─────────────────────────────────────────────────
router.delete('/admin/api/users/:id', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const target = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logAction(actor, 'delete_user', req.params.id, target?.email);
  res.json({ ok: true });
}));

// ── Admin API: grant / revoke pilot status on an existing user ─────────────
router.post('/admin/api/users/:id/pilot', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const { value } = req.body; // 1 or 0
  await db.prepare('UPDATE users SET is_pilot = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
  logAction(actor, value ? 'grant_pilot' : 'revoke_pilot', req.params.id);
  res.json({ ok: true });
}));

// ── Admin API: feedback submissions ────────────────────────────────────────
router.get('/admin/api/feedback', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const rows = await db
    .prepare(
      `SELECT feedback.id, feedback.email, feedback.message, feedback.page, feedback.created_at,
              users.email AS account_email
       FROM feedback
       LEFT JOIN users ON users.id = feedback.user_id
       ORDER BY feedback.id DESC
       LIMIT 200`
    )
    .all();
  res.json(rows);
}));

router.delete('/admin/api/feedback/:id', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  await db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  logAction(actor, 'delete_feedback', null, 'feedback #' + req.params.id);
  res.json({ ok: true });
}));

// ── Admin API: audit log ────────────────────────────────────────────────────
router.get('/admin/api/audit-log', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const rows = await db
    .prepare(
      `SELECT admin_audit_log.*, users.email AS target_email
       FROM admin_audit_log
       LEFT JOIN users ON users.id = admin_audit_log.target_user_id
       ORDER BY admin_audit_log.id DESC
       LIMIT 200`
    )
    .all();
  res.json(rows);
}));

router.post('/admin/api/users/:id/push-test', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const userId = Number(req.params.id);
  const { title = 'Capital Flow — Test', body = 'Push notifications are working! 🎉' } = req.body || {};
  try {
    const { sendPushToUser, configured } = require('../services/webPush');
    if (!configured) return res.status(503).json({ error: 'VAPID keys not configured' });
    const result = await sendPushToUser(userId, { title, body, tag: 'admin-test', data: { url: '/' } });
    // Surface the real delivery outcome so the admin can PROVE a push reached
    // the push service (delivered = a 2xx from FCM/Mozilla → the device gets
    // it even with the app closed), not just that the request didn't error.
    res.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, '[admin push-test]');
    res.status(500).json({ error: 'Server error' });
  }
}));

// ── Admin API: last successful DB backup ────────────────────────────────────
router.get('/admin/api/backup-status', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();
  res.json({ lastBackupAt: row ? Number(row.value) : null });
}));

// Runs the same backup email the daily scheduler runs, on demand — lets the
// admin panel tell "not configured" apart from "actually failing to send"
// instead of just waiting up to 24h to find out, and gives a real error
// message (bad Gmail app password, etc.) instead of a silent no-op.
router.post('/admin/api/backup/run-now', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL } = require('../config');
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ADMIN_EMAIL) {
    return res.status(400).json({ error: 'Backup email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD / ADMIN_EMAIL).' });
  }
  try {
    await require('../services/dbBackup').runBackupTick();
    logAction(actor, 'manual_backup', null, null);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[admin backup-now]');
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
}));

// ── Admin API: site-visit counts (sessions that opened the site) ────────────
router.get('/admin/api/visits', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const { getVisitStats } = require('../services/siteVisits');
  res.json(await getVisitStats());
}));

// ── Admin API: coupons ──────────────────────────────────────────────────────
// The only way to create a coupon used to be a raw DB insert — this is the
// actual admin-facing management surface for the coupon system wired up in
// server/routes/checkout.js (validated + attached at checkout time) and
// server/routes/webhooks.js (redeemed once payment actually succeeds).
router.get('/admin/api/coupons', asyncRoute(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  const rows = await db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
  res.json(rows);
}));

const VALID_APPLIES_TO = new Set(['both', 'premium', 'elite']);

router.post('/admin/api/coupons', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const { code, discountPercent, appliesTo, maxUses, expiresAt } = req.body || {};
  const normalizedCode = String(code || '').trim().toUpperCase();
  const pct = Number(discountPercent);
  if (!normalizedCode) return res.status(400).json({ error: 'Code is required' });
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
    return res.status(400).json({ error: 'Discount percent must be a whole number from 1-100' });
  }
  const applies = VALID_APPLIES_TO.has(appliesTo) ? appliesTo : 'both';
  const max = maxUses === '' || maxUses == null ? null : Number(maxUses);
  if (max != null && (!Number.isInteger(max) || max < 1)) {
    return res.status(400).json({ error: 'Max uses must be a positive whole number, or left blank for unlimited' });
  }
  let expires = null;
  if (expiresAt) {
    const ms = new Date(expiresAt).getTime();
    if (Number.isNaN(ms)) return res.status(400).json({ error: 'Invalid expiry date' });
    expires = Math.floor(ms / 1000);
  }
  try {
    await db
      .prepare('INSERT INTO coupons (code, discount_percent, applies_to, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(normalizedCode, pct, applies, max, expires);
  } catch (err) {
    return res.status(409).json({ error: 'A coupon with that code already exists' });
  }
  logAction(actor, 'coupon_create', null, normalizedCode);
  res.json({ ok: true });
}));

router.post('/admin/api/coupons/:id/active', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const { value } = req.body; // 1 or 0
  const coupon = await db.prepare('SELECT code FROM coupons WHERE id = ?').get(req.params.id);
  await db.prepare('UPDATE coupons SET active = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
  logAction(actor, value ? 'coupon_enable' : 'coupon_disable', null, coupon && coupon.code);
  res.json({ ok: true });
}));

router.delete('/admin/api/coupons/:id', asyncRoute(async (req, res) => {
  const actor = await checkToken(req, res);
  if (!actor) return;
  const coupon = await db.prepare('SELECT code FROM coupons WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  logAction(actor, 'coupon_delete', null, coupon && coupon.code);
  res.json({ ok: true });
}));

// ── Admin UI ───────────────────────────────────────────────────────────────
router.get('/admin', asyncRoute(async (req, res) => {
  // The page shell is public — no server-side auth here.
  // Every data API call (/admin/api/*) still enforces checkToken.
  // Auth headers are built in the browser from localStorage (always fresh).
  // Credentials are read from request headers by the page script. Never copy
  // a static admin secret into this HTML response or accept it in the URL.

  // Per-request nonce for the inline <script> and <style>. This lets the admin
  // page run under a real Content-Security-Policy: script-src carries the nonce
  // and NOT 'unsafe-inline', so an injected <script> (even if escaping ever
  // failed) cannot execute. All former inline on* handlers were moved into the
  // nonce'd script via event delegation. Inline style="" attributes remain, so
  // style-src keeps 'unsafe-inline' — style injection is a far lower risk and
  // every user-controlled value is already escaped with escapeHtml().
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); // never cache — prevents stale JWT in HTML
  res.setHeader(
    'Content-Security-Policy',
    [
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
    ].join('; ')
  );
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Capital Flow</title>
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0A0A0A; color: #E4E4E7; min-height: 100vh; }
  .topbar { display: flex; align-items: center; justify-content: space-between;
            padding: 14px 28px; border-bottom: 1px solid rgba(255,255,255,0.06);
            background: #111; position: sticky; top: 0; z-index: 10; flex-wrap: wrap; gap: 10px; }
  .topbar h1 { font-size: 16px; font-weight: 700; color: #F59E0B; letter-spacing: -0.01em; }
  .topbar span { font-size: 12px; color: #71717A; font-family: monospace; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 24px 60px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
           gap: 12px; margin-bottom: 28px; }
  .stat { background: #141414; border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px; padding: 16px 20px; }
  .stat-val { font-size: 28px; font-weight: 800; color: #F59E0B; font-variant-numeric: tabular-nums; }
  .stat-lbl { font-size: 11px; color: #71717A; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
  .card { background: #141414; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; overflow: hidden; }
  .card-hdr { padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
              display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .card-hdr h2 { font-size: 14px; font-weight: 600; }
  #search { background: #1C1C1C; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
            color: #E4E4E7; font-size: 13px; padding: 6px 12px; outline: none; width: 220px; }
  #search::placeholder { color: #444; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { padding: 10px 16px; text-align: left; font-size: 10px; font-weight: 600;
             letter-spacing: 0.06em; text-transform: uppercase; color: #71717A;
             border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
  tbody tr { border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: rgba(255,255,255,0.025); }
  tbody tr.blocked-row { opacity: 0.45; }
  td { padding: 10px 16px; vertical-align: middle; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px;
           font-size: 10px; font-weight: 700; letter-spacing: 0.04em; }
  .badge-pro    { background: rgba(245,158,11,0.15); color: #F59E0B; border: 1px solid rgba(245,158,11,0.25); }
  .badge-elite  { background: rgba(168,85,247,0.15); color: #A855F7; border: 1px solid rgba(168,85,247,0.3); }
  .badge-free   { background: rgba(113,113,122,0.12); color: #71717A; border: 1px solid rgba(113,113,122,0.2); }
  .badge-ok     { background: rgba(34,197,94,0.12); color: #22C55E; border: 1px solid rgba(34,197,94,0.2); }
  .badge-no     { background: rgba(239,68,68,0.10); color: #EF4444; border: 1px solid rgba(239,68,68,0.2); }
  .badge-blocked{ background: rgba(239,68,68,0.15); color: #EF4444; border: 1px solid rgba(239,68,68,0.3); }
  .badge-pilot  { background: rgba(168,85,247,0.15); color: #A855F7; border: 1px solid rgba(168,85,247,0.3); }
  .email { font-family: monospace; font-size: 12px; }
  .date  { font-family: monospace; font-size: 11px; color: #71717A; }
  .center { text-align: center; }
  .loader { text-align: center; padding: 48px; color: #555; font-size: 13px; }
  .btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
         border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;
         border: 1px solid transparent; transition: opacity .15s; white-space: nowrap; }
  .btn:hover { opacity: .8; }
  .btn:disabled { opacity: .35; cursor: default; }
  .btn-tier-free    { background: rgba(113,113,122,0.12); color: #A0A0A8; border-color: rgba(113,113,122,0.25); }
  .btn-tier-premium { background: rgba(245,158,11,0.12); color: #F59E0B; border-color: rgba(245,158,11,0.3); }
  .btn-tier-elite   { background: rgba(168,85,247,0.12); color: #A855F7; border-color: rgba(168,85,247,0.3); }
  .btn-tier-active  { opacity: 1; box-shadow: inset 0 0 0 1px currentColor; }
  .btn-block  { background: rgba(239,68,68,0.10); color: #EF4444; border-color: rgba(239,68,68,0.25); }
  .btn-unblock{ background: rgba(34,197,94,0.10); color: #22C55E; border-color: rgba(34,197,94,0.25); }
  .btn-del    { background: rgba(239,68,68,0.08); color: #7F1D1D; border-color: rgba(239,68,68,0.15); }
  .btn-pilot-on  { background: rgba(168,85,247,0.12); color: #A855F7; border-color: rgba(168,85,247,0.3); }
  .btn-pilot-off { background: rgba(113,113,122,0.10); color: #A0A0A8; border-color: rgba(113,113,122,0.2); }
  .btn-logout    { background: rgba(59,130,246,0.10); color: #3B82F6; border-color: rgba(59,130,246,0.25); }
  .btn-push-test { background: rgba(0,255,136,0.10); color: #00FF88; border-color: rgba(0,255,136,0.25); }
  .badge-push    { background: rgba(34,197,94,0.12); color: #22C55E; border: 1px solid rgba(34,197,94,0.2); }
  .actions    { display: flex; gap: 4px; flex-wrap: wrap; }
  .refresh-btn { background: none; border: 1px solid rgba(255,255,255,0.1); color: #A0A0A8;
                 font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
  .refresh-btn:hover { background: rgba(255,255,255,0.05); color: #E4E4E7; }
  .admin-token-form { display:flex; gap:6px; align-items:center; }
  .admin-token-form input { width:180px; background:#1C1C1C; border:1px solid rgba(255,255,255,0.1); color:#E4E4E7; border-radius:6px; padding:5px 8px; font:11px monospace; }
  .coupon-form { display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:14px 20px; border-bottom:1px solid rgba(255,255,255,0.06); }
  .coupon-form input, .coupon-form select { background:#1C1C1C; border:1px solid rgba(255,255,255,0.1); color:#E4E4E7; border-radius:6px; padding:6px 10px; font-size:12px; }
  .coupon-form input[name="code"] { width:130px; font-family:monospace; text-transform:uppercase; }
  .coupon-form input[name="discountPercent"] { width:60px; }
  .coupon-form input[name="maxUses"] { width:70px; }
  .coupon-form input[name="expiresAt"] { width:150px; }
  .coupon-code { font-family:monospace; font-weight:700; letter-spacing:0.03em; }
  .back-link:hover { color: #E4E4E7 !important; }
  .feedback-row { padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .feedback-row:last-child { border-bottom: none; }
  .feedback-row-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .feedback-who { font-size: 12px; font-weight: 600; color: #E4E4E7; }
  .feedback-date { font-size: 11px; color: #71717A; font-family: monospace; margin-left: auto; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: #1C1C1C;
           border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
           padding: 12px 18px; font-size: 13px; color: #E4E4E7;
           box-shadow: 0 8px 24px rgba(0,0,0,0.4); opacity: 0; pointer-events: none;
           transition: opacity .25s; z-index: 999; }
  .toast.show { opacity: 1; }
  #table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  @media (max-width: 640px) {
    .wrap { padding: 16px 12px 40px; }
    .topbar { padding: 12px 16px; }
    .topbar h1 { font-size: 14px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    #search { width: 100%; }
    .admin-token-form { width:100%; }
    .admin-token-form input { flex:1; width:auto; }
    .card-hdr { flex-direction: column; align-items: flex-start; }
    .card-hdr > div { width: 100%; }
    .toast { left: 12px; right: 12px; bottom: 12px; }
  }
</style>
</head>
<body>
<div class="topbar">
  <h1>⚡ Capital Flow — Admin</h1>
  <div style="display:flex;align-items:center;gap:16px">
    <div class="admin-token-form">
      <input id="admin-token-input" type="password" autocomplete="off" placeholder="Static admin token" aria-label="Static admin token" />
      <button class="refresh-btn" id="admin-token-save" type="button">Use token</button>
    </div>
    <span style="font-size:11px;font-family:monospace;padding:3px 10px;border-radius:4px;font-weight:700;${TURSO_DB_URL ? 'background:rgba(34,197,94,0.12);color:#22C55E;border:1px solid rgba(34,197,94,0.25)' : 'background:rgba(239,68,68,0.12);color:#EF4444;border:1px solid rgba(239,68,68,0.25)'}">${DB_ENV}</span>
    <span id="last-refresh">Loading…</span>
    <a href="/" class="back-link" style="font-size:12px;color:#71717A;text-decoration:none;border:1px solid rgba(255,255,255,0.1);padding:5px 12px;border-radius:6px;transition:color .15s">← Back to site</a>
  </div>
</div>
<div class="wrap">
  <div class="stats" id="stats">
    <div class="stat"><div class="stat-val" id="s-visits-today">—</div><div class="stat-lbl">Visits Today</div></div>
    <div class="stat"><div class="stat-val" id="s-visits-week">—</div><div class="stat-lbl">Visits (7d)</div></div>
    <div class="stat"><div class="stat-val" id="s-visits-total">—</div><div class="stat-lbl">Visits (all time)</div></div>
    <div class="stat"><div class="stat-val" id="s-total">—</div><div class="stat-lbl">Total Users</div></div>
    <div class="stat"><div class="stat-val" id="s-verified">—</div><div class="stat-lbl">Verified</div></div>
    <div class="stat"><div class="stat-val" id="s-premium">—</div><div class="stat-lbl">Premium</div></div>
    <div class="stat"><div class="stat-val" id="s-elite">—</div><div class="stat-lbl">Elite</div></div>
    <div class="stat"><div class="stat-val" id="s-blocked">—</div><div class="stat-lbl">Blocked</div></div>
    <div class="stat"><div class="stat-val" id="s-pilot">—</div><div class="stat-lbl">Pilot</div></div>
    <div class="stat"><div class="stat-val" id="s-today">—</div><div class="stat-lbl">Joined Today</div></div>
    <div class="stat"><div class="stat-val" id="s-week">—</div><div class="stat-lbl">This Week</div></div>
    <div class="stat"><div class="stat-val" id="s-active">—</div><div class="stat-lbl">Active (7d)</div></div>
    <div class="stat"><div class="stat-val" id="s-push">—</div><div class="stat-lbl">Push Enabled</div></div>
    <div class="stat"><div class="stat-val" id="s-alerts">—</div><div class="stat-lbl">Watchlist Alerts Set</div></div>
    <div class="stat"><div class="stat-val" id="s-price-alerts">—</div><div class="stat-lbl">Price Alerts Set</div></div>
    <div class="stat">
      <div class="stat-val" id="s-backup">—</div>
      <div class="stat-lbl">Last DB Backup</div>
      <a href="#" id="backup-run-now" style="display:inline-block;margin-top:6px;font-size:11px;color:#71717A;text-decoration:underline;cursor:pointer">Run now</a>
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-hdr">
      <h2>Activity Log</h2>
      <button class="refresh-btn" id="btn-refresh-audit">↻ Refresh</button>
    </div>
    <div id="audit-wrap"><div class="loader">Loading…</div></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-hdr">
      <h2>Coupons</h2>
      <button class="refresh-btn" id="btn-refresh-coupons">↻ Refresh</button>
    </div>
    <form class="coupon-form" id="coupon-form">
      <input name="code" placeholder="CODE" required maxlength="40" />
      <input name="discountPercent" type="number" min="1" max="100" placeholder="% off" required />
      <select name="appliesTo">
        <option value="both">Both tiers</option>
        <option value="premium">Premium only</option>
        <option value="elite">Elite only</option>
      </select>
      <input name="maxUses" type="number" min="1" placeholder="Max uses (blank = ∞)" />
      <input name="expiresAt" type="date" placeholder="Expires" />
      <button type="submit" class="btn btn-tier-elite">+ Create coupon</button>
    </form>
    <div id="coupons-wrap"><div class="loader">Loading…</div></div>
  </div>

  <div class="card">
    <div class="card-hdr">
      <h2>Users</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="search" placeholder="Filter by email…" />
        <button class="refresh-btn" id="btn-refresh-users">↻ Refresh</button>
      </div>
    </div>
    <div id="table-wrap">
      <div class="loader">Loading users…</div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script nonce="${nonce}">
// Static ADMIN_TOKEN wins when provided via URL; otherwise use the live JWT
// from localStorage — it's always fresh and never needs a manual refresh.
function authHeaders() {
  const staticToken = sessionStorage.getItem('vs_admin_token') || '';
  return staticToken
    ? { 'x-admin-token': staticToken }
    : { 'Authorization': 'Bearer ' + (localStorage.getItem('vs_token') || '') };
}
let AUTH_HEADERS = authHeaders();
function refreshAuthHeaders() { AUTH_HEADERS = authHeaders(); return AUTH_HEADERS; }

document.getElementById('admin-token-save').addEventListener('click', function () {
  const value = document.getElementById('admin-token-input').value.trim();
  if (!value) return;
  sessionStorage.setItem('vs_admin_token', value);
  refreshAuthHeaders();
  load();
  loadAuditLog();
  loadVisits();
  loadBackupStatus();
  loadCoupons();
});

let allUsers = [];

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function load() {
  document.getElementById('last-refresh').textContent = 'Refreshing…';
  try {
    const r = await fetch('/admin/api/users', { headers: AUTH_HEADERS });
    if (!r.ok) { document.getElementById('table-wrap').innerHTML = '<div class="loader">Error loading users.</div>'; return false; }
    allUsers = await r.json();
    renderStats(allUsers);
    renderTable(allUsers);
    document.getElementById('last-refresh').textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
    return true;
  } catch(e) {
    document.getElementById('table-wrap').innerHTML = '<div class="loader">Failed to fetch.</div>';
    return false;
  }
}

const ACTION_LABEL = {
  force_logout: '⏻ Force logout',
  set_tier: '🎫 Set tier',
  block_user: '⊘ Block',
  unblock_user: '✓ Unblock',
  delete_user: '✕ Delete user',
  grant_pilot: '🔬 Grant pilot',
  revoke_pilot: 'Revoke pilot',
  pilot_allowlist_add: '+ Pilot allowlist',
  pilot_allowlist_remove: '− Pilot allowlist',
  coupon_create: '+ Coupon',
  coupon_enable: 'Enable coupon',
  coupon_disable: 'Disable coupon',
  coupon_delete: '✕ Delete coupon',
  self_service_upgrade: '💳 Self-service upgrade',
  refund_downgrade: '↩ Refund downgrade',
  delete_feedback: '✕ Delete feedback',
  manual_backup: '💾 Manual backup',
};

async function loadAuditLog() {
  try {
    const r = await fetch('/admin/api/audit-log', { headers: AUTH_HEADERS });
    if (!r.ok) return false;
    const rows = await r.json();
    const el = document.getElementById('audit-wrap');
    if (!rows.length) { el.innerHTML = '<div class="loader">No admin actions logged yet.</div>'; return true; }
    el.innerHTML = rows.map(function(row) {
      const label = ACTION_LABEL[row.action] || row.action;
      const target = row.target_email ? \` · <span style="color:#A0A0A8">\${escapeHtml(row.target_email)}</span>\`
        : row.detail ? \` · <span style="color:#A0A0A8">\${escapeHtml(row.detail)}</span>\` : '';
      const detailSuffix = row.target_email && row.detail ? \` (\${escapeHtml(row.detail)})\` : '';
      const date = new Date(row.created_at * 1000).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return \`<div class="feedback-row">
        <div class="feedback-row-hdr">
          <span class="feedback-who">\${label}\${target}\${detailSuffix} <span style="color:#444">— \${escapeHtml(row.actor)}</span></span>
          <span class="feedback-date">\${date}</span>
        </div>
      </div>\`;
    }).join('');
    return true;
  } catch(e) { return false; }
}

const BACKUP_STALE_HOURS = 48;

async function loadBackupStatus() {
  const el = document.getElementById('s-backup');
  try {
    const r = await fetch('/admin/api/backup-status', { headers: AUTH_HEADERS });
    const data = r.ok ? await r.json() : { lastBackupAt: null };
    if (!data.lastBackupAt) {
      el.textContent = 'Never';
      el.style.color = '#EF4444';
      return;
    }
    const hoursAgo = (Date.now() / 1000 - data.lastBackupAt) / 3600;
    const stale = hoursAgo > BACKUP_STALE_HOURS;
    el.textContent = hoursAgo < 1 ? '<1h ago' : hoursAgo < 48 ? Math.round(hoursAgo) + 'h ago' : Math.round(hoursAgo / 24) + 'd ago';
    el.style.color = stale ? '#EF4444' : '#F59E0B';
  } catch (e) {
    el.textContent = '—';
  }
}

async function runBackupNow() {
  const link = document.getElementById('backup-run-now');
  link.textContent = 'Running…';
  try {
    const r = await fetch('/admin/api/backup/run-now', { method: 'POST', headers: AUTH_HEADERS });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      toast('✓ Backup sent');
      loadBackupStatus();
    } else {
      toast(d.error || 'Backup failed', true);
    }
  } catch (e) {
    toast('Backup failed', true);
  } finally {
    link.textContent = 'Run now';
  }
}

let allCoupons = [];

async function loadCoupons() {
  try {
    const r = await fetch('/admin/api/coupons', { headers: AUTH_HEADERS });
    if (!r.ok) { document.getElementById('coupons-wrap').innerHTML = '<div class="loader">Error loading coupons.</div>'; return false; }
    allCoupons = await r.json();
    renderCoupons(allCoupons);
    return true;
  } catch (e) {
    document.getElementById('coupons-wrap').innerHTML = '<div class="loader">Failed to fetch.</div>';
    return false;
  }
}

function renderCoupons(coupons) {
  const el = document.getElementById('coupons-wrap');
  if (!coupons.length) { el.innerHTML = '<div class="loader">No coupons yet — create one above.</div>'; return; }
  const now = Date.now() / 1000;
  const rows = coupons.map(function (c) {
    const expired = c.expires_at && c.expires_at < now;
    const maxedOut = c.max_uses != null && c.uses_count >= c.max_uses;
    const statusBadge = !c.active
      ? '<span class="badge badge-no">Disabled</span>'
      : expired
        ? '<span class="badge badge-no">Expired</span>'
        : maxedOut
          ? '<span class="badge badge-no">Limit reached</span>'
          : '<span class="badge badge-ok">Active</span>';
    const usage = c.max_uses != null ? c.uses_count + ' / ' + c.max_uses : c.uses_count + ' / ∞';
    const expiresLabel = c.expires_at ? new Date(c.expires_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const appliesLabel = c.applies_to === 'both' ? 'Premium + Elite' : c.applies_to === 'premium' ? 'Premium only' : 'Elite only';
    const toggleBtn = c.active
      ? '<button class="btn btn-block" data-act="coupon-toggle" data-id="' + c.id + '" data-val="0">Disable</button>'
      : '<button class="btn btn-unblock" data-act="coupon-toggle" data-id="' + c.id + '" data-val="1">Enable</button>';
    const delBtn = '<button class="btn btn-del" data-act="coupon-del" data-id="' + c.id + '" data-code="' + escapeHtml(c.code) + '">✕</button>';
    return '<tr>' +
      '<td class="coupon-code">' + escapeHtml(c.code) + '</td>' +
      '<td>' + c.discount_percent + '%</td>' +
      '<td>' + appliesLabel + '</td>' +
      '<td class="center" style="font-family:monospace;font-size:12px">' + usage + '</td>' +
      '<td class="date">' + expiresLabel + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td><div class="actions">' + toggleBtn + delBtn + '</div></td>' +
      '</tr>';
  }).join('');
  el.innerHTML = '<table><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th class="center">Uses</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

async function createCoupon(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const body = {
    code: fd.get('code'),
    discountPercent: Number(fd.get('discountPercent')),
    appliesTo: fd.get('appliesTo'),
    maxUses: fd.get('maxUses') || null,
    expiresAt: fd.get('expiresAt') || null,
  };
  const r = await fetch('/admin/api/coupons', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok) { toast('✓ Coupon created'); form.reset(); loadCoupons(); }
  else toast(d.error || 'Error creating coupon', true);
}

async function toggleCoupon(id, value) {
  const r = await fetch('/admin/api/coupons/' + id + '/active', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ value }),
  });
  if (r.ok) { toast(value ? 'Coupon enabled' : 'Coupon disabled'); loadCoupons(); }
  else toast('Error', true);
}

async function deleteCoupon(id, code) {
  if (!confirm('Delete coupon ' + code + '? This cannot be undone.')) return;
  const r = await fetch('/admin/api/coupons/' + id, { method: 'DELETE', headers: AUTH_HEADERS });
  if (r.ok) { toast('Coupon deleted'); loadCoupons(); }
  else toast('Error', true);
}

async function loadVisits() {
  try {
    const r = await fetch('/admin/api/visits', { headers: AUTH_HEADERS });
    const d = r.ok ? await r.json() : { today: 0, last7: 0, total: 0 };
    document.getElementById('s-visits-today').textContent = (d.today || 0).toLocaleString();
    document.getElementById('s-visits-week').textContent  = (d.last7 || 0).toLocaleString();
    document.getElementById('s-visits-total').textContent = (d.total || 0).toLocaleString();
  } catch (e) {}
}

async function setPilot(id, value) {
  const r = await fetch(\`/admin/api/users/\${id}/pilot\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ value })
  });
  if (r.ok) { toast(value ? '🔬 Pilot tag added' : 'Pilot tag removed'); load(); }
  else toast('Error', true);
}

// users.created_at is SQLite's datetime('now') default: "YYYY-MM-DD HH:MM:SS"
// UTC with no timezone marker. new Date() would otherwise parse that as the
// browser's local time, silently skewing every date shown below.
function parseUsersDate(str) {
  return new Date(typeof str === 'string' && !str.includes('T') ? str.replace(' ', 'T') + 'Z' : str);
}

function renderStats(users) {
  const now = new Date();
  const today = now.toDateString();
  const weekAgo = new Date(now - 7 * 864e5);
  document.getElementById('s-total').textContent    = users.length;
  document.getElementById('s-verified').textContent = users.filter(u => u.is_verified).length;
  document.getElementById('s-premium').textContent  = users.filter(u => u.tier === 'premium').length;
  document.getElementById('s-elite').textContent    = users.filter(u => u.tier === 'elite').length;
  document.getElementById('s-blocked').textContent  = users.filter(u => u.is_blocked).length;
  document.getElementById('s-pilot').textContent    = users.filter(u => u.is_pilot).length;
  document.getElementById('s-today').textContent    = users.filter(u => parseUsersDate(u.created_at).toDateString() === today).length;
  document.getElementById('s-week').textContent     = users.filter(u => parseUsersDate(u.created_at) >= weekAgo).length;
  document.getElementById('s-active').textContent   = users.filter(u => u.last_login_at && new Date(u.last_login_at * 1000) >= weekAgo).length;
  document.getElementById('s-push').textContent     = users.filter(u => u.push_count > 0).length;
  document.getElementById('s-alerts').textContent   = users.reduce((sum, u) => sum + (u.alert_count || 0), 0);
  document.getElementById('s-price-alerts').textContent = users.reduce((sum, u) => sum + (u.price_alert_count || 0), 0);
}

function renderTable(users) {
  if (!users.length) {
    document.getElementById('table-wrap').innerHTML = '<div class="loader">No users found.</div>';
    return;
  }
  const rows = users.map((u, i) => {
    const rawEmail = u.email || u.google_email || '—';
    const email   = escapeHtml(rawEmail);
    const method  = u.google_email ? '🔵 Google' : '✉️ Email';
    const verified= u.is_verified ? '<span class="badge badge-ok">Verified</span>' : '<span class="badge badge-no">Unverified</span>';
    const tier    = u.tier || 'free';
    const plan    = tier === 'elite' ? '<span class="badge badge-elite">ELITE</span>'
                  : tier === 'premium' ? '<span class="badge badge-pro">PREMIUM</span>'
                  : '<span class="badge badge-free">FREE</span>';
    const status  = u.is_blocked ? '<span class="badge badge-blocked">Blocked</span>' : '';
    const pilotBadge = u.is_pilot
      ? \`<span class="badge badge-pilot" title="\${u.pilot_terms_accepted_at ? 'Terms accepted' : 'Terms not yet accepted'}">PILOT\${u.pilot_terms_accepted_at ? '' : ' ⏳'}</span>\`
      : '';
    const date    = parseUsersDate(u.created_at).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const lastLogin = u.last_login_at
      ? new Date(u.last_login_at * 1000).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '<span style="color:#444">Never</span>';

    const tierBtns = ['free', 'premium', 'elite'].map(function(t) {
      const active = tier === t ? ' btn-tier-active' : '';
      const label = t === 'free' ? 'Free' : t === 'premium' ? 'Premium' : 'Elite';
      return \`<button class="btn btn-tier-\${t}\${active}" data-act="set-tier" data-id="\${u.id}" data-tier="\${t}">\${label}</button>\`;
    }).join('');

    const pilotBtn = u.is_pilot
      ? \`<button class="btn btn-pilot-off" data-act="set-pilot" data-id="\${u.id}" data-val="0">Remove pilot</button>\`
      : \`<button class="btn btn-pilot-on"  data-act="set-pilot" data-id="\${u.id}" data-val="1">🔬 Mark pilot</button>\`;

    const blockBtn = u.is_blocked
      ? \`<button class="btn btn-unblock" data-act="set-block" data-id="\${u.id}" data-val="0">✓ Unblock</button>\`
      : \`<button class="btn btn-block"   data-act="set-block" data-id="\${u.id}" data-val="1">⊘ Block</button>\`;

    const logoutBtn = \`<button class="btn btn-logout" data-act="force-logout" data-id="\${u.id}" title="Ends their current session on every device">⏻ Force logout</button>\`;

    const pushTestBtn = u.push_count > 0
      ? \`<button class="btn btn-push-test" data-act="push-test" data-id="\${u.id}" title="Send a test push notification to this user">🔔 Test push</button>\`
      : '';

    const delBtn = \`<button class="btn btn-del" data-act="del-user" data-id="\${u.id}" data-email="\${email}">✕</button>\`;

    const usage = tier === 'elite'
      ? '∞'
      : tier === 'premium'
        ? (u.premium_scan_count || 0) + '/5 today'
        : (function() {
            const trialEndMs = parseUsersDate(u.created_at).getTime() + 7 * 24 * 60 * 60 * 1000;
            const daysLeft = Math.ceil((trialEndMs - Date.now()) / (24 * 60 * 60 * 1000));
            return daysLeft > 0 ? daysLeft + 'd trial left' : 'Trial ended';
          })();

    const notifCell = tier !== 'elite' ? '<span style="color:#444">—</span>' : [
      u.push_count > 0 ? \`<span class="badge badge-push" title="\${u.push_count} device(s) subscribed">Push</span>\` : '',
      u.alert_count > 0 ? (function() {
        const volumeCount = u.alert_count - (u.price_alert_count || 0);
        const parts = [];
        if (volumeCount > 0) parts.push(volumeCount + ' vol');
        if (u.price_alert_count > 0) parts.push(u.price_alert_count + ' price');
        return \`<span class="badge badge-pro" title="\${u.alert_count} watchlist alert threshold(s)">\${parts.join(' / ')} alert\${u.alert_count === 1 ? '' : 's'}</span>\`;
      })() : '',
      u.notification_time ? \`<span class="badge badge-free" title="Daily digest time (Israel)">\${escapeHtml(u.notification_time)}</span>\` : '',
    ].filter(Boolean).join(' ') || '<span style="color:#444">—</span>';

    return \`<tr id="row-\${u.id}" class="\${u.is_blocked ? 'blocked-row' : ''}">
      <td class="center" style="color:#555;font-size:11px">\${users.length - i}</td>
      <td class="email">\${email}</td>
      <td style="font-size:12px;color:#A0A0A8">\${method}</td>
      <td>\${verified} \${status}</td>
      <td>\${plan} \${pilotBadge}</td>
      <td class="center" style="font-family:monospace;font-size:12px">\${usage}</td>
      <td>\${notifCell}</td>
      <td class="date">\${date}</td>
      <td class="date">\${lastLogin}</td>
      <td><div class="actions">\${tierBtns}\${pilotBtn}\${logoutBtn}\${pushTestBtn}\${blockBtn}\${delBtn}</div></td>
    </tr>\`;
  }).join('');

  document.getElementById('table-wrap').innerHTML = \`
    <table>
      <thead><tr>
        <th class="center">#</th>
        <th>Email</th>
        <th>Method</th>
        <th>Status</th>
        <th>Plan</th>
        <th class="center">Usage</th>
        <th>Notifications</th>
        <th>Joined</th>
        <th>Last Login</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>\${rows}</tbody>
    </table>\`;
}

function filterTable() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const filtered = q ? allUsers.filter(u => (u.email || u.google_email || '').toLowerCase().includes(q)) : allUsers;
  renderTable(filtered);
}

async function setTier(id, tier) {
  const r = await fetch(\`/admin/api/users/\${id}/tier\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ tier })
  });
  if (r.ok) { toast('Tier set to ' + tier); load(); }
  else toast('Error — check console', true);
}

async function setBlock(id, value) {
  const r = await fetch(\`/admin/api/users/\${id}/block\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ value })
  });
  if (r.ok) { toast(value ? '⊘ User blocked' : '✓ User unblocked'); load(); }
  else toast('Error', true);
}

async function forceLogout(id) {
  const r = await fetch(\`/admin/api/users/\${id}/logout\`, { method: 'POST', headers: AUTH_HEADERS });
  if (r.ok) toast('⏻ Session ended — their token no longer works');
  else toast('Error', true);
}

async function deleteUser(id, email) {
  if (!confirm(\`Delete \${email}? This cannot be undone.\`)) return;
  const r = await fetch(\`/admin/api/users/\${id}\`, { method: 'DELETE', headers: AUTH_HEADERS });
  if (r.ok) { toast('User deleted'); load(); }
  else toast('Error', true);
}

async function sendTestPush(id) {
  const r = await fetch(\`/admin/api/users/\${id}/push-test\`, { method: 'POST', headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Capital Flow — Test', body: 'Push notifications are working! 🎉 You will receive alerts automatically.' }) });
  if (r.ok) {
    const d = await r.json();
    if (d.devices === 0) toast('No subscribed devices for this user', true);
    else if (d.delivered > 0) toast(\`🔔 Delivered to \${d.delivered}/\${d.devices} device(s) — push service accepted it\`);
    else toast(\`Sent to \${d.devices} device(s) but none accepted (\${d.removed} expired)\`, true);
  }
  else { const d = await r.json(); toast('Push error: ' + (d.error || r.status), true); }
}

function toast(msg, err) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = err ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Event delegation ────────────────────────────────────────────────────────
// Every button action is wired here instead of via inline onclick="" — that is
// what lets the whole page run under a Content-Security-Policy whose script-src
// has NO 'unsafe-inline'. Dynamic rows carry data-act + data-* attributes; a
// single delegated listener reads them and dispatches. Browsers decode HTML
// entities in attribute values on parse, so escapeHtml'd emails/codes arrive
// here as their real string.
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const d = btn.dataset;
  switch (d.act) {
    case 'set-tier':      return setTier(d.id, d.tier);
    case 'set-pilot':     return setPilot(d.id, Number(d.val));
    case 'set-block':     return setBlock(d.id, Number(d.val));
    case 'force-logout':  return forceLogout(d.id);
    case 'push-test':     return sendTestPush(d.id);
    case 'del-user':      return deleteUser(d.id, d.email);
    case 'coupon-toggle': return toggleCoupon(d.id, Number(d.val));
    case 'coupon-del':    return deleteCoupon(d.id, d.code);
  }
});
document.getElementById('coupon-form').addEventListener('submit', createCoupon);
document.getElementById('btn-refresh-coupons').addEventListener('click', async function () {
  const ok = await loadCoupons();
  toast(ok ? 'Refreshed' : 'Refresh failed', !ok);
});

// Static controls (present in the initial HTML, not regenerated)
// Refresh buttons show a toast on click specifically — not from inside
// load()/loadAuditLog() themselves, since those also run silently every 60s
// in the background and on initial page load, where a toast would just be
// noise. This way a click always confirms it landed, whether or not the
// data actually changed.
document.getElementById('btn-refresh-audit').addEventListener('click', async function () {
  const ok = await loadAuditLog();
  toast(ok ? 'Refreshed' : 'Refresh failed', !ok);
});
document.getElementById('btn-refresh-users').addEventListener('click', async function () {
  const ok = await load();
  toast(ok ? 'Refreshed' : 'Refresh failed', !ok);
});
document.getElementById('search').addEventListener('input', filterTable);
document.getElementById('backup-run-now').addEventListener('click', function (e) {
  e.preventDefault();
  runBackupNow();
});

load();
loadAuditLog();
loadBackupStatus();
loadVisits();
loadCoupons();
setInterval(load, 60000);
setInterval(loadAuditLog, 60000);
setInterval(loadBackupStatus, 60000);
setInterval(loadVisits, 60000);
setInterval(loadCoupons, 60000);
</script>
</body>
</html>`);
}));

module.exports = router;
