// Health monitoring that actually runs in production — the standalone
// monitor.js at the repo root was designed to run as a PM2 cron job every 5
// minutes (see ecosystem.config.js), but the Docker image's entrypoint runs
// `node server.js` directly with no PM2 involved at all, so that script has
// never actually executed in the deployed container. This ports the same
// "3 consecutive failures → email, then a recovery email once it's back"
// logic into an in-process setInterval instead, started from server/index.js
// alongside the background scanner and scheduled backup — the same pattern
// already proven to actually run there.
//
// State no longer needs to survive on disk: monitor.js persisted failCount/
// alerted to a JSON file because each PM2 cron invocation was a brand-new
// process with no memory of the last one. Here the same process just keeps
// running, so a plain in-memory variable is enough — one less thing to fail
// on Render's ephemeral filesystem.
const http = require('http');
const nodemailer = require('nodemailer');
const { PORT, ADMIN_EMAIL, GMAIL_USER, GMAIL_APP_PASSWORD } = require('../config');

const HEALTH_URL = `http://localhost:${PORT}/health`;
const FAIL_THRESHOLD = 3;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000; // let the HTTP server finish binding first

let state = { failCount: 0, alerted: false };

function createTransport() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

function sendAlert(subject, body) {
  const transport = createTransport();
  if (!transport || !ADMIN_EMAIL) {
    console.warn('[health-monitor] Email not configured — set GMAIL_USER + GMAIL_APP_PASSWORD + ADMIN_EMAIL to receive downtime alerts');
    return;
  }
  transport
    .sendMail({
      from: `"Capital Flow Monitor" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject,
      text: body,
    })
    .then(() => console.log('[health-monitor] Alert sent:', subject))
    .catch((err) => console.error('[health-monitor] Alert send failed:', err.message));
}

function onFail(reason) {
  state.failCount++;
  console.error(`[health-monitor] [FAIL] #${state.failCount} - ${reason}`);

  if (state.failCount >= FAIL_THRESHOLD && !state.alerted) {
    state.alerted = true;
    sendAlert(
      `[Capital Flow] SERVER DOWN (${state.failCount} consecutive failures)`,
      `Capital Flow's own /health check is failing.\n\nReason: ${reason}\nFail count: ${state.failCount}\nTime: ${new Date().toISOString()}`
    );
  }
}

function checkHealth() {
  const req = http.get(HEALTH_URL, { timeout: 5000 }, (res) => {
    res.resume();
    if (res.statusCode === 200) {
      if (state.alerted) {
        console.log('[health-monitor] [OK] Recovered after', state.failCount, 'failures');
        sendAlert(
          '[Capital Flow] Server recovered',
          `The server is back online.\n\nRecovered at: ${new Date().toISOString()}\nConsecutive failures before recovery: ${state.failCount}`
        );
      }
      state = { failCount: 0, alerted: false };
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

function startHealthMonitor() {
  setTimeout(checkHealth, STARTUP_DELAY_MS).unref();
  setInterval(checkHealth, CHECK_INTERVAL_MS).unref();
}

module.exports = { startHealthMonitor, checkHealth };
