const router = require('express').Router();
const db = require('../db');
const { ADMIN_TOKEN, ADMIN_EMAIL } = require('../config');
const { verifyToken } = require('../services/auth');
const pilotAllowlist = require('../services/pilotAllowlist');

const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;

function checkToken(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(503).send('Admin panel disabled — set ADMIN_TOKEN in .env');
    return false;
  }

  // Accept static token
  const tok = req.query.token || req.headers['x-admin-token'];
  if (tok === ADMIN_TOKEN) return true;

  // Accept JWT from the admin email
  const jwt = req.query.jwt || (req.headers.authorization || '').replace('Bearer ', '');
  if (jwt && ADMIN_EMAIL) {
    try {
      const payload = verifyToken(jwt);
      const user = db.prepare('SELECT email, is_blocked FROM users WHERE id = ?').get(payload.id);
      if (user && !user.is_blocked && user.email === ADMIN_EMAIL) return true;
    } catch (_) {}
  }

  res.status(401).send('Unauthorized');
  return false;
}

// ── Admin API: user list ───────────────────────────────────────────────────
router.get('/admin/api/users', (req, res) => {
  if (!checkToken(req, res)) return;
  const users = db
    .prepare(
      `
    SELECT id, email, google_email, is_verified, is_premium, is_blocked, is_pilot, tier,
           pilot_terms_accepted_at, free_scan_count, created_at, notification_time,
           free_scan_used_capital_flow, free_scan_used_ma_scanner, free_scan_used_sector_moving,
           premium_scan_count, premium_scan_window_start,
           (SELECT COUNT(*) FROM watchlist_alerts    WHERE user_id = users.id) AS alert_count,
           (SELECT COUNT(*) FROM push_subscriptions  WHERE user_id = users.id) AS push_count
    FROM users ORDER BY id DESC
  `
    )
    .all();
  res.json(users);
});

// ── Admin API: force sign-out — bumps session_version so every token issued
// before now (on any device) is rejected on its next request. Useful for the
// single-active-session system added alongside the tier rework: previously
// only a full block could interrupt an active session; this ends just the
// session without touching tier/verification/pilot status.
router.post('/admin/api/users/:id/logout', (req, res) => {
  if (!checkToken(req, res)) return;
  db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

const VALID_TIERS = new Set(['free', 'premium', 'elite']);

// ── Admin API: set subscription tier ───────────────────────────────────────
router.post('/admin/api/users/:id/tier', (req, res) => {
  if (!checkToken(req, res)) return;
  const { tier } = req.body;
  if (!VALID_TIERS.has(tier)) return res.status(400).json({ error: 'tier must be free, premium, or elite' });
  db.prepare('UPDATE users SET tier = ?, is_premium = ? WHERE id = ?').run(
    tier,
    tier !== 'free' ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true, tier });
});

// ── Admin API: block / unblock ────────────────────────────────────────────
router.post('/admin/api/users/:id/block', (req, res) => {
  if (!checkToken(req, res)) return;
  const { value } = req.body; // 1 or 0
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ── Admin API: delete user ─────────────────────────────────────────────────
router.delete('/admin/api/users/:id', (req, res) => {
  if (!checkToken(req, res)) return;
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Admin API: grant / revoke pilot status on an existing user ─────────────
// This only toggles the pilot restrictions (single session, watermark,
// confidentiality gate) — it is not a security control. To actually cut off
// a user's access immediately, use the block toggle above instead.
router.post('/admin/api/users/:id/pilot', (req, res) => {
  if (!checkToken(req, res)) return;
  const { value } = req.body; // 1 or 0
  db.prepare('UPDATE users SET is_pilot = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ── Admin API: pilot allowlist (pre-approved emails) ────────────────────────
router.get('/admin/api/pilot-allowlist', (req, res) => {
  if (!checkToken(req, res)) return;
  res.json(pilotAllowlist.listAllowlist());
});

router.post('/admin/api/pilot-allowlist', (req, res) => {
  if (!checkToken(req, res)) return;
  const email = String(req.body.email || '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });
  pilotAllowlist.addToAllowlist(email);
  res.json({ ok: true });
});

router.delete('/admin/api/pilot-allowlist/:email', (req, res) => {
  if (!checkToken(req, res)) return;
  pilotAllowlist.removeFromAllowlist(req.params.email);
  res.json({ ok: true });
});

// ── Admin API: feedback submissions ────────────────────────────────────────
router.get('/admin/api/feedback', (req, res) => {
  if (!checkToken(req, res)) return;
  const rows = db
    .prepare(
      `
    SELECT feedback.id, feedback.email, feedback.message, feedback.page, feedback.created_at,
           users.email AS account_email
    FROM feedback
    LEFT JOIN users ON users.id = feedback.user_id
    ORDER BY feedback.id DESC
    LIMIT 200
  `
    )
    .all();
  res.json(rows);
});

router.delete('/admin/api/feedback/:id', (req, res) => {
  if (!checkToken(req, res)) return;
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Admin API: coupons ──────────────────────────────────────────────────────
const VALID_APPLIES_TO = new Set(['both', 'premium', 'elite']);
// Excludes visually-ambiguous characters (0/O, 1/I/L) since codes are meant
// to be typed by hand or read off a shared screenshot.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

router.get('/admin/api/coupons', (req, res) => {
  if (!checkToken(req, res)) return;
  const rows = db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
  res.json(rows);
});

router.post('/admin/api/coupons', (req, res) => {
  if (!checkToken(req, res)) return;
  const { discountPercent, appliesTo, maxUses, expiresInDays, paddleDiscountId } = req.body;
  let { code } = req.body;

  const pct = parseInt(discountPercent, 10);
  if (!(pct >= 1 && pct <= 100)) return res.status(400).json({ error: 'Discount must be between 1 and 100' });
  const scope = VALID_APPLIES_TO.has(appliesTo) ? appliesTo : 'both';

  code = code && String(code).trim() ? String(code).trim().toUpperCase() : generateCode();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return res.status(400).json({ error: 'Code must be 3-32 letters/numbers/dashes' });
  }

  const max = maxUses != null && maxUses !== '' ? parseInt(maxUses, 10) : null;
  const expiresAt =
    expiresInDays != null && expiresInDays !== ''
      ? Math.floor(Date.now() / 1000) + parseInt(expiresInDays, 10) * 86400
      : null;

  const paddleId = paddleDiscountId && String(paddleDiscountId).trim() ? String(paddleDiscountId).trim() : null;

  try {
    db.prepare(
      'INSERT INTO coupons (code, discount_percent, applies_to, max_uses, expires_at, paddle_discount_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(code, pct, scope, max, expiresAt, paddleId);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'That code already exists' });
    throw err;
  }
  res.json({ ok: true, code });
});

router.post('/admin/api/coupons/:code/toggle', (req, res) => {
  if (!checkToken(req, res)) return;
  const { active } = req.body;
  db.prepare('UPDATE coupons SET active = ? WHERE code = ?').run(active ? 1 : 0, req.params.code.toUpperCase());
  res.json({ ok: true });
});

router.delete('/admin/api/coupons/:code', (req, res) => {
  if (!checkToken(req, res)) return;
  db.prepare('DELETE FROM coupons WHERE code = ?').run(req.params.code.toUpperCase());
  res.json({ ok: true });
});

// ── Admin UI ───────────────────────────────────────────────────────────────
router.get('/admin', (req, res) => {
  if (!checkToken(req, res)) return;
  const token = req.query.token;
  const jwt = req.query.jwt;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Capital Flow</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0A0A0A; color: #E4E4E7; min-height: 100vh; }
  .topbar { display: flex; align-items: center; justify-content: space-between;
            padding: 14px 28px; border-bottom: 1px solid rgba(255,255,255,0.06);
            background: #111; position: sticky; top: 0; z-index: 10; }
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
  .badge-push    { background: rgba(34,197,94,0.12); color: #22C55E; border: 1px solid rgba(34,197,94,0.2); }
  .pilot-add { display: flex; gap: 8px; padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .pilot-add input { flex: 1; background: #1C1C1C; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
                      color: #E4E4E7; font-size: 13px; padding: 6px 12px; outline: none; }
  .pilot-add button { background: rgba(168,85,247,0.14); color: #A855F7; border: 1px solid rgba(168,85,247,0.3);
                       border-radius: 6px; font-size: 12px; font-weight: 600; padding: 6px 16px; cursor: pointer; }
  .pilot-list { padding: 4px 20px 16px; display: flex; flex-wrap: wrap; gap: 8px; }
  .pilot-chip { display: inline-flex; align-items: center; gap: 8px; background: rgba(168,85,247,0.08);
                border: 1px solid rgba(168,85,247,0.2); border-radius: 100px; padding: 4px 6px 4px 12px;
                font-size: 12px; font-family: monospace; color: #D4B3F7; }
  .pilot-chip button { background: none; border: none; color: #A855F7; cursor: pointer; font-size: 14px;
                        width: 18px; height: 18px; border-radius: 50%; line-height: 1; }
  .pilot-chip button:hover { background: rgba(168,85,247,0.2); }
  .pilot-empty { padding: 4px 20px 16px; font-size: 12px; color: #555; }
  .actions    { display: flex; gap: 4px; flex-wrap: wrap; }
  .coupon-add { display: flex; gap: 8px; padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; }
  .coupon-add input, .coupon-add select { background: #1C1C1C; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
                      color: #E4E4E7; font-size: 13px; padding: 6px 12px; outline: none; }
  .coupon-add button { background: rgba(249,115,22,0.14); color: #F97316; border: 1px solid rgba(249,115,22,0.3);
                       border-radius: 6px; font-size: 12px; font-weight: 600; padding: 6px 16px; cursor: pointer; white-space: nowrap; }
  .coupon-row { display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-bottom: 1px solid rgba(255,255,255,0.04); flex-wrap: wrap; }
  .coupon-row:last-child { border-bottom: none; }
  .coupon-code { font-family: monospace; font-size: 13px; color: #E4E4E7; font-weight: 700; min-width: 100px; }
  .coupon-pct { font-size: 11px; background: rgba(249,115,22,0.12); color: #F97316; padding: 2px 8px; border-radius: 4px; }
  .coupon-scope { font-size: 11px; color: #71717A; }
  .coupon-meta { font-size: 11px; color: #71717A; margin-left: auto; }
  .coupon-empty { padding: 20px; font-size: 12px; color: #555; text-align: center; }
  .refresh-btn { background: none; border: 1px solid rgba(255,255,255,0.1); color: #A0A0A8;
                 font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
  .refresh-btn:hover { background: rgba(255,255,255,0.05); color: #E4E4E7; }
  .feedback-row { padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .feedback-row:last-child { border-bottom: none; }
  .feedback-row-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .feedback-who { font-size: 12px; font-weight: 600; color: #E4E4E7; }
  .feedback-date { font-size: 11px; color: #71717A; font-family: monospace; margin-left: auto; }
  .feedback-del { background: none; border: none; color: #7F1D1D; cursor: pointer; font-size: 12px; padding: 0 4px; }
  .feedback-del:hover { color: #EF4444; }
  .feedback-msg { font-size: 13px; color: #D4D4D8; line-height: 1.5; white-space: pre-wrap; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: #1C1C1C;
           border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
           padding: 12px 18px; font-size: 13px; color: #E4E4E7;
           box-shadow: 0 8px 24px rgba(0,0,0,0.4); opacity: 0; pointer-events: none;
           transition: opacity .25s; z-index: 999; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="topbar">
  <h1>⚡ Capital Flow — Admin</h1>
  <div style="display:flex;align-items:center;gap:16px">
    <span id="last-refresh">Loading…</span>
    <a href="/" style="font-size:12px;color:#71717A;text-decoration:none;border:1px solid rgba(255,255,255,0.1);padding:5px 12px;border-radius:6px;transition:color .15s" onmouseover="this.style.color='#E4E4E7'" onmouseout="this.style.color='#71717A'">← Back to site</a>
  </div>
</div>
<div class="wrap">
  <div class="stats" id="stats">
    <div class="stat"><div class="stat-val" id="s-total">—</div><div class="stat-lbl">Total Users</div></div>
    <div class="stat"><div class="stat-val" id="s-verified">—</div><div class="stat-lbl">Verified</div></div>
    <div class="stat"><div class="stat-val" id="s-premium">—</div><div class="stat-lbl">Premium</div></div>
    <div class="stat"><div class="stat-val" id="s-elite">—</div><div class="stat-lbl">Elite</div></div>
    <div class="stat"><div class="stat-val" id="s-blocked">—</div><div class="stat-lbl">Blocked</div></div>
    <div class="stat"><div class="stat-val" id="s-pilot">—</div><div class="stat-lbl">Pilot</div></div>
    <div class="stat"><div class="stat-val" id="s-today">—</div><div class="stat-lbl">Joined Today</div></div>
    <div class="stat"><div class="stat-val" id="s-week">—</div><div class="stat-lbl">This Week</div></div>
    <div class="stat"><div class="stat-val" id="s-push">—</div><div class="stat-lbl">Push Enabled</div></div>
    <div class="stat"><div class="stat-val" id="s-alerts">—</div><div class="stat-lbl">Watchlist Alerts Set</div></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-hdr">
      <h2>Pilot Program — Invite Allowlist</h2>
      <span style="font-size:11px;color:#71717A">Emails below auto-tag as PILOT on signup</span>
    </div>
    <div class="pilot-add">
      <input id="pilot-email" placeholder="tester@company.com" onkeydown="if(event.key==='Enter')addPilotEmail()" />
      <button onclick="addPilotEmail()">+ Add to pilot</button>
    </div>
    <div class="pilot-list" id="pilot-list"><span class="pilot-empty">Loading…</span></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-hdr">
      <h2>Feedback</h2>
      <button class="refresh-btn" onclick="loadFeedback()">↻ Refresh</button>
    </div>
    <div id="feedback-wrap"><div class="loader">Loading…</div></div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-hdr">
      <h2>Coupons</h2>
      <span id="coupon-count" style="font-size:11px;color:#71717A"></span>
    </div>
    <div class="coupon-add">
      <input id="coupon-code" placeholder="CODE (blank = auto)" style="text-transform:uppercase" />
      <input id="coupon-pct" type="number" min="1" max="100" placeholder="% off" style="width:70px" />
      <select id="coupon-scope">
        <option value="both">Both tiers</option>
        <option value="premium">Premium only</option>
        <option value="elite">Elite only</option>
      </select>
      <input id="coupon-max-uses" type="number" min="1" placeholder="Max uses" style="width:90px" />
      <input id="coupon-expires" type="number" min="1" placeholder="Expires (days)" style="width:110px" />
      <input id="coupon-paddle-id" placeholder="Paddle discount ID (optional)" style="width:180px" />
      <button onclick="createCoupon()">+ Create</button>
    </div>
    <div style="padding:0 20px 12px;font-size:11px;color:#71717A">
      To actually charge the discounted price at checkout, create a matching discount in Paddle's dashboard and paste its ID here — otherwise this coupon only changes what's displayed, not what Paddle bills.
    </div>
    <div id="coupon-wrap"><div class="loader">Loading…</div></div>
  </div>

  <div class="card">
    <div class="card-hdr">
      <h2>Users</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="search" placeholder="Filter by email…" oninput="filterTable()" />
        <button class="refresh-btn" onclick="load()">↻ Refresh</button>
      </div>
    </div>
    <div id="table-wrap">
      <div class="loader">Loading users…</div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
// The token only ever travels in the URL for this single initial page load.
// Strip it from the address bar and browser history immediately, then use it
// only as an in-memory Authorization header for every subsequent request —
// it never appears in a URL, referrer, or server access log again.
const AUTH_HEADERS = ${jwt ? `{ 'Authorization': 'Bearer ${jwt}' }` : `{ 'x-admin-token': '${token}' }`};
history.replaceState(null, '', '/admin');

let allUsers = [];

// Defense in depth: every value below is written into innerHTML via template
// strings (not React), so anything user-controlled — an email, in
// particular — must be escaped before it's interpolated, even though the
// server now also rejects malformed emails at signup.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function load() {
  document.getElementById('last-refresh').textContent = 'Refreshing…';
  try {
    const r = await fetch('/admin/api/users', { headers: AUTH_HEADERS });
    if (!r.ok) { document.getElementById('table-wrap').innerHTML = '<div class="loader">Error loading users.</div>'; return; }
    allUsers = await r.json();
    renderStats(allUsers);
    renderTable(allUsers);
    document.getElementById('last-refresh').textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
  } catch(e) {
    document.getElementById('table-wrap').innerHTML = '<div class="loader">Failed to fetch.</div>';
  }
  loadPilotAllowlist();
}

async function loadFeedback() {
  try {
    const r = await fetch('/admin/api/feedback', { headers: AUTH_HEADERS });
    const rows = r.ok ? await r.json() : [];
    const el = document.getElementById('feedback-wrap');
    if (!rows.length) { el.innerHTML = '<div class="loader">No feedback yet.</div>'; return; }
    el.innerHTML = rows.map(function(row) {
      const who = escapeHtml(row.account_email || row.email || 'Anonymous');
      const page = row.page ? \` · <span style="color:#71717A">\${escapeHtml(row.page)}</span>\` : '';
      const date = new Date(row.created_at * 1000).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return \`<div class="feedback-row">
        <div class="feedback-row-hdr">
          <span class="feedback-who">\${who}\${page}</span>
          <span class="feedback-date">\${date}</span>
          <button class="feedback-del" onclick="deleteFeedback(\${row.id})" title="Delete">✕</button>
        </div>
        <div class="feedback-msg">\${escapeHtml(row.message)}</div>
      </div>\`;
    }).join('');
  } catch(e) {}
}

async function deleteFeedback(id) {
  const r = await fetch('/admin/api/feedback/' + id, { method: 'DELETE', headers: AUTH_HEADERS });
  if (r.ok) loadFeedback();
}

const SCOPE_LABEL = { both: 'Both tiers', premium: 'Premium only', elite: 'Elite only' };

async function loadCoupons() {
  try {
    const r = await fetch('/admin/api/coupons', { headers: AUTH_HEADERS });
    const rows = r.ok ? await r.json() : [];
    document.getElementById('coupon-count').textContent = rows.filter(c => c.active).length + ' active';
    const el = document.getElementById('coupon-wrap');
    if (!rows.length) { el.innerHTML = '<div class="coupon-empty">No coupons yet — create one above.</div>'; return; }
    el.innerHTML = rows.map(function(c) {
      const uses = c.uses_count + (c.max_uses ? ' / ' + c.max_uses : '') + ' used';
      const expired = c.expires_at && c.expires_at < Math.floor(Date.now() / 1000);
      const status = !c.active
        ? '<span class="badge badge-free">Disabled</span>'
        : expired
          ? '<span class="badge badge-no">Expired</span>'
          : '<span class="badge badge-ok">Active</span>';
      const toggleBtn = c.active
        ? \`<button class="btn btn-pilot-off" onclick="toggleCoupon('\${c.code}', false)">Disable</button>\`
        : \`<button class="btn btn-pilot-on" onclick="toggleCoupon('\${c.code}', true)">Enable</button>\`;
      const paddleBadge = c.paddle_discount_id
        ? \`<span class="badge badge-ok" title="\${escapeHtml(c.paddle_discount_id)}">Paddle linked</span>\`
        : \`<span class="badge badge-no" title="Discount won't be reflected at actual checkout">No Paddle link</span>\`;
      return \`<div class="coupon-row">
        <span class="coupon-code">\${escapeHtml(c.code)}</span>
        <span class="coupon-pct">\${c.discount_percent}% off</span>
        <span class="coupon-scope">\${SCOPE_LABEL[c.applies_to] || c.applies_to}</span>
        \${status}
        \${paddleBadge}
        <span class="coupon-meta">\${uses}</span>
        <div class="actions">
          \${toggleBtn}
          <button class="btn btn-del" onclick="deleteCoupon('\${c.code}')">✕</button>
        </div>
      </div>\`;
    }).join('');
  } catch(e) {}
}

async function createCoupon() {
  const code = document.getElementById('coupon-code').value.trim();
  const discountPercent = document.getElementById('coupon-pct').value;
  const appliesTo = document.getElementById('coupon-scope').value;
  const maxUses = document.getElementById('coupon-max-uses').value;
  const expiresInDays = document.getElementById('coupon-expires').value;
  const paddleDiscountId = document.getElementById('coupon-paddle-id').value.trim();
  if (!discountPercent) { toast('Enter a discount percentage', true); return; }
  const r = await fetch('/admin/api/coupons', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ code, discountPercent, appliesTo, maxUses, expiresInDays, paddleDiscountId })
  });
  const data = await r.json();
  if (r.ok) {
    toast('Coupon ' + data.code + ' created');
    document.getElementById('coupon-code').value = '';
    document.getElementById('coupon-pct').value = '';
    document.getElementById('coupon-max-uses').value = '';
    document.getElementById('coupon-expires').value = '';
    document.getElementById('coupon-paddle-id').value = '';
    loadCoupons();
  } else {
    toast(data.error || 'Error', true);
  }
}

async function toggleCoupon(code, active) {
  const r = await fetch('/admin/api/coupons/' + code + '/toggle', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ active })
  });
  if (r.ok) loadCoupons();
  else toast('Error', true);
}

async function deleteCoupon(code) {
  if (!confirm('Delete coupon ' + code + '?')) return;
  const r = await fetch('/admin/api/coupons/' + code, { method: 'DELETE', headers: AUTH_HEADERS });
  if (r.ok) { toast('Coupon deleted'); loadCoupons(); }
  else toast('Error', true);
}

async function loadPilotAllowlist() {
  try {
    const r = await fetch('/admin/api/pilot-allowlist', { headers: AUTH_HEADERS });
    const list = r.ok ? await r.json() : [];
    const el = document.getElementById('pilot-list');
    if (!list.length) { el.innerHTML = '<span class="pilot-empty">No pilot invites yet — add an email above.</span>'; return; }
    el.innerHTML = list.map(function(row) {
      const safe = escapeHtml(row.email);
      const jsSafe = row.email.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
      return \`<span class="pilot-chip">\${safe}<button onclick="removePilotEmail('\${escapeHtml(jsSafe)}')" title="Remove">✕</button></span>\`;
    }).join('');
  } catch(e) {}
}

async function addPilotEmail() {
  const input = document.getElementById('pilot-email');
  const email = input.value.trim();
  if (!email || !email.includes('@')) { toast('Enter a valid email', true); return; }
  const r = await fetch('/admin/api/pilot-allowlist', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ email })
  });
  if (r.ok) { input.value = ''; toast('Added to pilot allowlist'); loadPilotAllowlist(); }
  else toast('Error', true);
}

async function removePilotEmail(email) {
  const r = await fetch('/admin/api/pilot-allowlist/' + encodeURIComponent(email), { method: 'DELETE', headers: AUTH_HEADERS });
  if (r.ok) { toast('Removed'); loadPilotAllowlist(); }
  else toast('Error', true);
}

async function setPilot(id, value) {
  const r = await fetch(\`/admin/api/users/\${id}/pilot\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({ value })
  });
  if (r.ok) { toast(value ? '🔬 Pilot tag added' : 'Pilot tag removed'); load(); }
  else toast('Error', true);
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
  document.getElementById('s-today').textContent    = users.filter(u => new Date(u.created_at).toDateString() === today).length;
  document.getElementById('s-week').textContent     = users.filter(u => new Date(u.created_at) >= weekAgo).length;
  document.getElementById('s-push').textContent     = users.filter(u => u.push_count > 0).length;
  document.getElementById('s-alerts').textContent   = users.reduce((sum, u) => sum + (u.alert_count || 0), 0);
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
    const date    = new Date(u.created_at).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });

    const tierBtns = ['free', 'premium', 'elite'].map(function(t) {
      const active = tier === t ? ' btn-tier-active' : '';
      const label = t === 'free' ? 'Free' : t === 'premium' ? 'Premium' : 'Elite';
      return \`<button class="btn btn-tier-\${t}\${active}" onclick="setTier(\${u.id}, '\${t}')">\${label}</button>\`;
    }).join('');

    const pilotBtn = u.is_pilot
      ? \`<button class="btn btn-pilot-off" onclick="setPilot(\${u.id}, 0)">Remove pilot</button>\`
      : \`<button class="btn btn-pilot-on"  onclick="setPilot(\${u.id}, 1)">🔬 Mark pilot</button>\`;

    const blockBtn = u.is_blocked
      ? \`<button class="btn btn-unblock" onclick="setBlock(\${u.id}, 0)">✓ Unblock</button>\`
      : \`<button class="btn btn-block"   onclick="setBlock(\${u.id}, 1)">⊘ Block</button>\`;

    const logoutBtn = \`<button class="btn btn-logout" onclick="forceLogout(\${u.id})" title="Ends their current session on every device">⏻ Force logout</button>\`;

    const delBtn = \`<button class="btn btn-del" onclick="deleteUser(\${u.id}, '\${email.replace(/'/g,"\\\\'")}')">✕</button>\`;

    const usage = tier === 'elite'
      ? '∞'
      : tier === 'premium'
        ? (u.premium_scan_count || 0) + '/5 today'
        : [u.free_scan_used_capital_flow, u.free_scan_used_ma_scanner, u.free_scan_used_sector_moving].filter(Boolean).length + '/3 used';

    // Elite-only features (push/digest/watchlist alerts) — meaningless to
    // show for Free/Premium since they can't enable any of them.
    const notifCell = tier !== 'elite' ? '<span style="color:#444">—</span>' : [
      u.push_count > 0 ? \`<span class="badge badge-push" title="\${u.push_count} device(s) subscribed">Push</span>\` : '',
      u.alert_count > 0 ? \`<span class="badge badge-pro" title="\${u.alert_count} watchlist alert threshold(s)">\${u.alert_count} alert\${u.alert_count === 1 ? '' : 's'}</span>\` : '',
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
      <td><div class="actions">\${tierBtns}\${pilotBtn}\${logoutBtn}\${blockBtn}\${delBtn}</div></td>
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

function toast(msg, err) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = err ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

load();
loadFeedback();
loadCoupons();
setInterval(load, 60000);
setInterval(loadFeedback, 60000);
setInterval(loadCoupons, 60000);
</script>
</body>
</html>`);
});

module.exports = router;
