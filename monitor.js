/**
 * Health monitor — runs as a PM2 cron job every 5 minutes.
 * Pings /health and sends an email alert after 3 consecutive failures.
 * Sends a recovery email when the server comes back up.
 */
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3001;
const HEALTH_URL = `http://localhost:${PORT}/health`;
const ALERT_TO = process.env.ADMIN_EMAIL || '';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';
const THRESHOLD = 3;
const STATE_FILE = path.join(__dirname, 'data', '.monitor-state.json');

// ── Persisted state across cron runs ────────────────────────────────────────
let state = { failCount: 0, alerted: false };
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (_) {}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (_) {}
}

// ── Email alert ──────────────────────────────────────────────────────────────
function sendAlert(subject, body) {
  if (!GMAIL_USER || !GMAIL_PASS || !ALERT_TO) {
    console.warn('[monitor] Email not configured — set GMAIL_USER + GMAIL_APP_PASSWORD in .env');
    return;
  }
  nodemailer
    .createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    .sendMail({
      from: `"Capital Flow Monitor" <${GMAIL_USER}>`,
      to: ALERT_TO,
      subject,
      text: body,
    })
    .then(() => console.log('[monitor] Alert sent:', subject))
    .catch((err) => console.error('[monitor] Alert send failed:', err.message));
}

// ── Health check ─────────────────────────────────────────────────────────────
function checkHealth() {
  const req = http.get(HEALTH_URL, { timeout: 5000 }, (res) => {
    res.resume();
    if (res.statusCode === 200) {
      if (state.alerted) {
        console.log('[monitor] [OK] Server recovered after', state.failCount, 'failures');
        sendAlert(
          '[Capital Flow] Server recovered',
          `The server is back online.\n\nRecovered at: ${new Date().toISOString()}\nConsecutive failures before recovery: ${state.failCount}`
        );
      } else {
        console.log('[monitor] [OK] Healthy');
      }
      state = { failCount: 0, alerted: false };
      saveState();
    } else {
      onFail(`HTTP ${res.statusCode}`);
    }
  });

  req.on('timeout', () => {
    req.destroy();
    onFail('request timeout');
  });
  req.on('error', (err) => onFail(err.message));
}

function onFail(reason) {
  state.failCount++;
  console.error(`[monitor] [FAIL] #${state.failCount} - ${reason}`);
  saveState();

  if (state.failCount >= THRESHOLD && !state.alerted) {
    state.alerted = true;
    saveState();
    sendAlert(
      `[Capital Flow] SERVER DOWN (${state.failCount} consecutive failures)`,
      `Capital Flow is not responding!\n\nReason: ${reason}\nFail count: ${state.failCount}\nTime: ${new Date().toISOString()}\n\nRun this to diagnose:\n  pm2 status\n  pm2 logs capital-flow --lines 50`
    );
  }
}

checkHealth();
