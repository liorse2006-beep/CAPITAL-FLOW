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
const { reportError } = require('../utils/reportError');
const { backgroundTimeout, backgroundInterval } = require('./backgroundRuntime');

const HEALTH_URL = `http://localhost:${PORT}/health`;
const FAIL_THRESHOLD = 3;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000; // let the HTTP server finish binding first

let state = { failCount: 0, alerted: false };
let inFlight = null;
let started = false;

function createTransport() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function sendAlert(subject, body) {
  const transport = createTransport();
  if (!transport || !ADMIN_EMAIL) {
    console.warn(
      '[health-monitor] Email not configured — set GMAIL_USER + GMAIL_APP_PASSWORD + ADMIN_EMAIL to receive downtime alerts'
    );
    return false;
  }
  try {
    await transport.sendMail({
      from: `"Capital Flow Monitor" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject,
      text: body,
    });
    console.log('[health-monitor] Alert sent:', subject);
    return true;
  } catch (err) {
    reportError(err, '[health-monitor] Alert send failed');
    return false;
  }
}

async function onFail(reason) {
  state.failCount++;
  console.error(`[health-monitor] [FAIL] #${state.failCount} - ${reason}`);

  if (state.failCount >= FAIL_THRESHOLD && !state.alerted) {
    state.alerted = await sendAlert(
      `[Capital Flow] SERVER DOWN (${state.failCount} consecutive failures)`,
      `Capital Flow's own /health check is failing.\n\nReason: ${reason}\nFail count: ${state.failCount}\nTime: ${new Date().toISOString()}`
    );
  }
}

function probeHealth() {
  // A timeout is followed by request.destroy(), which commonly emits an
  // additional `error` event. Count one network attempt once only, otherwise
  // a single outage can advance the consecutive-failure threshold twice.
  return new Promise((resolve) => {
    let settled = false;
    let req;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(reason);
    };
    const timeout = () => {
      finish('request timeout');
      req?.destroy();
    };
    // A wall-clock deadline also bounds a response that trickles forever.
    const deadline = setTimeout(timeout, 5000);
    deadline.unref();
    try {
      req = http.get(HEALTH_URL, { timeout: 5000 }, (res) => {
        res.on('end', () => finish(res.statusCode === 200 ? null : `HTTP ${res.statusCode}`));
        res.on('error', (err) => finish(err.message));
        res.on('aborted', () => finish('response aborted'));
        res.resume();
      });
      req.on('timeout', timeout);
      req.on('error', (err) => finish(err.message));
    } catch (err) {
      finish(err.message);
    }
  }).then(async (reason) => {
    if (reason === null) {
      if (state.alerted) {
        console.log('[health-monitor] [OK] Recovered after', state.failCount, 'failures');
        await sendAlert(
          '[Capital Flow] Server recovered',
          `The server is back online.\n\nRecovered at: ${new Date().toISOString()}\nConsecutive failures before recovery: ${state.failCount}`
        );
      }
      state = { failCount: 0, alerted: false };
    } else {
      await onFail(reason);
    }
  });
}

function checkHealth() {
  if (inFlight) return inFlight;
  const work = probeHealth().finally(() => {
    if (inFlight === work) inFlight = null;
  });
  inFlight = work;
  return work;
}

function startHealthMonitor() {
  if (started) return;
  started = true;
  backgroundTimeout(checkHealth, STARTUP_DELAY_MS);
  backgroundInterval(checkHealth, CHECK_INTERVAL_MS);
}

module.exports = { startHealthMonitor, checkHealth };
