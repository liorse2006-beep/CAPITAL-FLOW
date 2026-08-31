require('./config'); // ensures dotenv runs
const { attachErrorHandler } = require('./sentry'); // must init before other requires that can throw
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');
const passport = require('passport');
const proxyaddr = require('proxy-addr');
const path = require('path');
const fs = require('fs');
const { PORT, SESSION_SECRET, FRONTEND_URL, TRUSTED_PROXY_CIDRS } = require('./config');
const { startBackgroundScheduler } = require('./services/backgroundScan');
const { startScheduledDigest } = require('./services/scheduledDigest');
const { startScheduledScanRunner } = require('./services/scheduledScanRunner');
const { startScheduledBackup } = require('./services/dbBackup');
const { startStatusMonitor } = require('./services/statusMonitor');
const { scanLimiter, apiLimiter, adminLimiter } = require('./middleware/rateLimiters');
const { isSingletonWorker } = require('./services/clusterBus');
const { safeErrorSummary } = require('./utils/reportError');

const app = express();

// Never trust X-Forwarded-For merely because the app happens to be behind a
// proxy in one deployment. If the origin is reachable directly, a hop-count
// setting lets an attacker manufacture a different client IP and rotate
// through every IP-based credential bucket. Trust only explicitly configured
// proxy source networks; an empty list deliberately falls back to the socket
// address (safe, though less granular behind an unconfigured proxy).
const trustedProxy = TRUSTED_PROXY_CIDRS.length ? proxyaddr.compile(TRUSTED_PROXY_CIDRS) : false;
app.set('trust proxy', trustedProxy);
if (process.env.NODE_ENV === 'production' && !TRUSTED_PROXY_CIDRS.length) {
  console.warn('[startup] TRUSTED_PROXY_CIDRS is empty; forwarded client IPs are ignored for rate limiting.');
}

// Security headers (X-Frame-Options, HSTS, noSniff, etc.) apply everywhere.
app.use(helmet({ contentSecurityPolicy: false }));

// The product does not need direct camera, microphone, location, or USB
// access. Disable those browser capabilities explicitly while leaving the
// payment policy untouched for the hosted checkout provider.
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=()');
  next();
});

// Gzip/Brotli-equivalent compression for every response — the built JS bundle
// and JSON scan payloads are the biggest wins here (helmet must run first so
// its headers aren't touched by compression's stream rewrite).
app.use(compression());

// Content-Security-Policy for the SPA — the strongest single mitigation
// against XSS impact: even if a script ever got injected, script-src 'self'
// stops it from running. Scoped to everything EXCEPT /admin, whose
// server-rendered page still relies on inline onclick="" handlers and a
// <style> block that would need a larger rewrite to run under this policy.
const spaCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    // WhopCheckoutEmbed (@whop/checkout/react — see EmbeddedCheckout.jsx)
    // injects its own script tags at runtime (the checkout mount script plus
    // a t.whop.tw tracking pixel) — without these, the embed silently fails
    // to load with nothing but a CSP violation, not a visible error.
    // Both the bare domain AND *.whop.com are listed deliberately — a
    // `*.` wildcard only matches subdomains (sandbox.whop.com), NOT the
    // apex domain itself, and the embed's iframe actually targets bare
    // https://whop.com/checkout/... — omitting it silently blocked the
    // iframe with no console output and no network request even attempted
    // (this exact bug shipped once already: "content is blocked" in the UI,
    // nothing in devtools to point at why).
    scriptSrc: [
      "'self'",
      'https://challenges.cloudflare.com',
      'https://whop.com',
      'https://*.whop.com',
      'https://whop.tw',
      'https://*.whop.tw',
      // posthog-js (src/analytics.js) is bundled into our own JS (covered by
      // 'self'), but once initialized it dynamically injects ADDITIONAL
      // <script> tags of its own for sub-features (web-vitals, session
      // recording, dead-clicks autocapture, surveys) fetched from this host.
      // connectSrc already allow-listed it for XHR/fetch, but that does
      // nothing for actual <script> loads — without this, every one of
      // those sub-scripts is silently CSP-blocked and PostHog effectively
      // never captures anything in production. Verified live: all five
      // sub-script loads were blocked with this origin missing.
      'https://us-assets.i.posthog.com',
      // Hash of the exact inline <script> in index.html that captures
      // `beforeinstallprompt` before React mounts (see that file's own
      // comment for why it must run inline and this early). Without this,
      // the script is silently CSP-blocked — verified live, same failure
      // mode as the PostHog gap above: no visible error to the user, the
      // install-prompt capture this session specifically added to fix a
      // reported bug just never ran. Recompute with:
      //   node -e "console.log('sha256-'+require('crypto').createHash('sha256').update(require('fs').readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]).digest('base64'))"
      // if that inline script's content ever changes.
      "'sha256-sJ744oqRX0m55C3zjyb/M1k15+4S7R0y/0tdCXb5Nj8='",
    ],
    // React sets inline styles via the CSSOM (style.setProperty), which CSP
    // treats the same as a literal style="" attribute — 'unsafe-inline' is
    // required here given how pervasively this app uses style={{...}}.
    // Fonts are self-hosted (see @font-face in src/styles/index.css), so no
    // external font-CDN origins are allow-listed here anymore.
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    // Ticker logos are fetched client-side from Parqet's public logo CDN
    // (see the `ticker-logo` <img> in ScannerPage/WatchlistPage) — without
    // this, every logo silently fails to load in production.
    imgSrc: [
      "'self'",
      'data:',
      'https://assets.parqet.com',
      'https://lh3.googleusercontent.com',
      'https://lh4.googleusercontent.com',
      'https://lh5.googleusercontent.com',
      'https://lh6.googleusercontent.com',
      'https://whop.com',
      'https://*.whop.com',
    ],
    // Sentry and PostHog are both opt-in (no-op without their respective
    // VITE_ env vars — see src/sentry.js and src/analytics.js), but the CSP
    // is baked in at server startup regardless of whether a key is set, so
    // these ingest endpoints are always allow-listed. An unused allow-list
    // entry is not a security downgrade.
    connectSrc: [
      "'self'",
      'https://*.ingest.sentry.io',
      'https://*.ingest.us.sentry.io',
      'https://*.ingest.de.sentry.io',
      'https://us.i.posthog.com',
      'https://us-assets.i.posthog.com',
      'https://challenges.cloudflare.com',
      'https://whop.com',
      'https://*.whop.com',
      'https://whop.tw',
      'https://*.whop.tw',
      // Google Pay (via Whop's express checkout button) talks to
      // pay.google.com; Apple Pay uses the browser's native Payment Request
      // API and needs no origin allow-listed here.
      'https://pay.google.com',
      // Same VITE_SCAN_WORKER_URL Render env var that gets baked into the
      // frontend bundle at build time (see Dockerfile) — reused here at
      // runtime so the CSP allow-list never drifts out of sync with
      // whatever origin the built JS actually fetches /api/scan from.
      ...(process.env.VITE_SCAN_WORKER_URL ? [process.env.VITE_SCAN_WORKER_URL] : []),
    ],
    // Turnstile renders its challenge inside a sandboxed iframe from
    // Cloudflare; the embedded checkout form itself is a whop.com iframe;
    // the Google Pay wallet sheet renders from pay.google.com.
    frameSrc: [
      "'self'",
      'https://challenges.cloudflare.com',
      'https://whop.com',
      'https://*.whop.com',
      'https://pay.google.com',
    ],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
  },
});
app.use((req, res, next) =>
  req.path.startsWith('/admin') || req.path.startsWith('/status') ? next() : spaCsp(req, res, next)
);

// CORS allowlist — the app is normally same-origin (backend serves the built
// frontend), so this only matters for local dev servers and the configured
// production frontend. Never reflect an arbitrary origin.
// Vite adds crossorigin to <script type="module"> tags which causes browsers
// to send an Origin header even for same-origin asset fetches — both the
// custom domain and the Render URL must be explicitly listed so neither blocks
// the other when FRONTEND_URL is updated between deploys.
const allowedOrigins = new Set([
  FRONTEND_URL,
  'https://capitalflow.vip',
  'https://www.capitalflow.vip',
  'https://capital-flow-3v59.onrender.com',
  // Local development origins must never be allowed to read credentialed
  // production responses. A page served from a local port can otherwise use
  // the browser's production refresh cookie and exfiltrate private API data.
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3001', 'http://localhost:5173']),
]);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
// Reads the httpOnly refresh-token cookie (see routes/auth.js) — no secret
// needed since the cookie's value is itself an opaque, unguessable token
// whose hash is checked against the DB; there is nothing to sign here.
app.use(cookieParser());

// Mounted BEFORE express.json() — Whop webhook signature verification
// must run over the exact raw bytes of the request body, which parsing
// (and re-serializing) as JSON would not reproduce.
app.use('/api/webhooks/whop', express.raw({ type: 'application/json', limit: '256kb' }));
app.use('/api', require('./routes/webhooks'));

app.use(express.json({ limit: '256kb' }));
// The OAuth handshake's session (just Passport's transient state — never
// real app data) lives entirely in a signed cookie on the client, not
// server memory. That was a deliberate choice, not just "the default":
// server-side session storage (express-session + MemoryStore, or any
// in-process store) only lives in the ONE process that handled the /google
// redirect — if a second server process/worker handles the /callback that
// follows a few seconds later, that process has never heard of the session
// and the login silently fails. A signed cookie carries the session with
// the browser itself, so it works identically whether one process or many
// end up handling the two halves of the OAuth round trip — this is what
// lets the app scale horizontally later without an OAuth outage.
app.use(
  cookieSession({
    name: 'vs.sess',
    keys: [SESSION_SECRET],
    // Explicitly mark the OAuth session cookie Secure in production. The
    // cookie-session package does not reliably infer this from a reverse proxy
    // in every deployment mode; an explicit flag avoids sending the signed
    // OAuth state over an accidental HTTP hop while keeping local HTTP dev
    // usable.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 10, // 10 min — only for the OAuth dance
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Serve static files — dist/ if built, else public/ fallback (checked at request time)
const distDir = path.join(__dirname, '../dist');
const publicDir = path.join(__dirname, '../public');
app.use(function (req, res, next) {
  const serveDir = fs.existsSync(distDir) ? distDir : publicDir;
  express.static(serveDir, {
    setHeaders: function (res, filePath) {
      // Vite fingerprints every file under assets/ with a content hash in the
      // name (index-Ab12Cd34.js) — the filename itself changes whenever the
      // content does, so it's safe to tell browsers to cache it forever and
      // skip the network entirely on repeat visits. Self-hosted font files
      // are equally static (same treatment as any CDN font host) — they only
      // ever change on a deliberate redesign, which ships alongside a CSS/JS
      // change that busts those hashed assets anyway. Everything else
      // (notably index.html, which references those hashed names) must
      // always be revalidated or users would get stuck on a stale build.
      if (
        filePath.includes(path.join(serveDir, 'assets') + path.sep) ||
        filePath.includes(path.join(serveDir, 'fonts') + path.sep)
      ) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })(req, res, next);
});

// Apple Pay domain verification. Whop (and Apple) fetch this exact path to
// confirm we own the domain before Apple Pay can appear in the embedded
// checkout. It needs an EXPLICIT route for two reasons the default setup
// breaks on: (1) express.static ignores dotfiles, so a file under
// .well-known/ is never served by it, and (2) the SPA fallback below would
// otherwise answer with index.html (HTTP 200 text/html), which is exactly
// what made Whop's verification hang — it got a web page instead of the
// token. Served as text/plain from a committed file; 404 (not the SPA) when
// the file isn't present yet, so a missing token fails loudly rather than
// silently returning HTML. Must come before the static + SPA handlers.
const APPLE_PAY_FILE = path.join(__dirname, '../public/.well-known/apple-developer-merchantid-domain-association');
app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
  fs.readFile(APPLE_PAY_FILE, 'utf8', (err, data) => {
    if (err || !data || !data.trim()) return res.status(404).type('text/plain').send('Not found');
    res.type('text/plain').send(data);
  });
});

// Health check — before all other routes so monitoring can always reach it
app.use('/', require('./routes/health'));

// Public status and private operations routes. They are server-rendered so
// the status page remains available without the main React app bundle.
app.use('/', require('./routes/status'));

// API routes (all mounted at /api)
app.use('/api', apiLimiter); // floor: every API route is throttled, not just the ones tuned individually
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/account'));
app.use('/api/scan', scanLimiter); // throttle the expensive volume scan
app.use('/api', require('./routes/scan'));
app.use('/api', require('./routes/sectors'));
app.use('/api', require('./routes/chart'));
app.use('/api', require('./routes/watchlist'));
app.use('/api', require('./routes/watchlistAlerts'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/chat'));
app.use('/api', require('./routes/news'));
app.use('/api', require('./routes/volumeContext'));
app.use('/api', require('./routes/background'));
app.use('/api', require('./routes/stream').router);
app.use('/api', require('./routes/maScanner'));
app.use('/api', require('./routes/fundamentals'));
app.use('/api', require('./routes/scanQuota'));
app.use('/api', require('./routes/push'));
app.use('/api', require('./routes/scheduledScans'));
app.use('/api', require('./routes/radar'));
app.use('/api', require('./routes/visits'));
app.use('/api', require('./routes/feedback'));
app.use('/api', require('./routes/coupons'));
app.use('/api', require('./routes/checkout'));
app.use('/admin', adminLimiter); // admin router is mounted at "/", not "/api" — it needs its own floor
app.use('/', require('./routes/admin'));

// Keep unknown API paths machine-readable. Without this boundary, the SPA
// fallback below returns index.html with HTTP 200 for a typo, an old client,
// or a missing endpoint. That masks integration failures and can make a
// monitoring check look healthy while the requested API operation did not
// exist. Known routes above still handle their own errors and responses.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// SPA fallback — MUST be last
app.get('/{*splat}', (req, res) => {
  const serveDir = fs.existsSync(distDir) ? distDir : publicDir;
  res.sendFile(path.join(serveDir, 'index.html'));
});

// Sentry's error handler must be registered after all routes so it sees
// errors they throw, and before any custom error middleware (there is none
// here — Express's default handler takes over after this, unchanged).
attachErrorHandler(app);

// Crashes that never reach an Express route (e.g. a rejected promise in the
// background scanner) would otherwise vanish silently — report them too.
//
// Both handlers now exit the process (after giving Sentry a moment to flush
// the event) instead of just logging and carrying on. Node's own docs are
// explicit that process state after an uncaughtException is undefined —
// limping along in that state indefinitely, still answering /health with
// 200 the whole time, is worse than a clean restart. The container's
// entrypoint runs `node server.js` directly (no PM2/supervisor wrapping it),
// so the platform's own restart-on-exit policy (Render, Docker, etc.) is
// what actually recovers the process — exiting is what makes that kick in
// at all, instead of leaving a half-broken process running forever with
// nothing to prompt a restart.
function crashCleanly(label, err) {
  console.error(`[${label}]`, safeErrorSummary(err));
  const { Sentry } = require('./sentry');
  Sentry.captureException(err);
  Sentry.flush(2000)
    .catch(() => {})
    .finally(() => process.exit(1));
}
process.on('unhandledRejection', (err) => crashCleanly('unhandledRejection', err));
process.on('uncaughtException', (err) => crashCleanly('uncaughtException', err));

// Each of these runs on an interval that mutates shared state (the
// background-scan cache, sends digests/pushes, writes a backup) — starting
// it in every worker would mean every worker doing that work redundantly
// (N background scans instead of one, N digest emails per user, etc).
// isSingletonWorker() is true in every non-cluster process (today's actual
// deployment, local dev, tests) and true for exactly one worker when
// running under server/cluster.js.
if (isSingletonWorker()) {
  startBackgroundScheduler();
  startScheduledDigest();
  startScheduledScanRunner();
  startScheduledBackup();
  startStatusMonitor();
}

app.listen(PORT, () => {
  console.log(`Volume Scanner running at http://localhost:${PORT}`);
  // The session store (now a signed cookie — see the cookieSession setup
  // above) and SSE broadcast/scan-scheduling (now routed through
  // services/clusterBus.js — see routes/stream.js, middleware/
  // authMiddleware.js's SSE ticket store, and isSingletonWorker() above)
  // are all safe to run as more than one process now. What's NOT
  // automatically cluster-aware: express-rate-limit's default MemoryStore
  // is still per-process, so under CLUSTER_WORKERS > 1 (see server.js) each
  // customer's rate-limit budget is effectively workers-many times looser
  // (still bounded, just not as tight as the configured number implies) —
  // a capacity/cost tradeoff to know about, not a correctness bug.
  if (process.env.CLUSTER_WORKERS && parseInt(process.env.CLUSTER_WORKERS, 10) > 1) {
    console.log('[startup] Running as one of multiple cluster workers — see server.js and services/clusterBus.js.');
  }
});

module.exports = app;
