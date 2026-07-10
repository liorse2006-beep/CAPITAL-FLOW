require('./config'); // ensures dotenv runs
const { attachErrorHandler } = require('./sentry'); // must init before other requires that can throw
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const passport = require('passport');
const path = require('path');
const fs = require('fs');
const { PORT, SESSION_SECRET, FRONTEND_URL } = require('./config');
const { startBackgroundScheduler } = require('./services/backgroundScan');
const { startScheduledDigest } = require('./services/scheduledDigest');
const { scanLimiter, apiLimiter, adminLimiter } = require('./middleware/rateLimiters');

const app = express();

app.set('trust proxy', 1); // correct client IP behind a reverse proxy (for rate limiting)

// Security headers (X-Frame-Options, HSTS, noSniff, etc.) apply everywhere.
app.use(helmet({ contentSecurityPolicy: false }));

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
    scriptSrc: ["'self'"],
    // React sets inline styles via the CSSOM (style.setProperty), which CSP
    // treats the same as a literal style="" attribute — 'unsafe-inline' is
    // required here given how pervasively this app uses style={{...}}.
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
      'https://api.fontshare.com',
      'https://cdn.fontshare.com',
    ],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.fontshare.com'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
  },
});
app.use((req, res, next) => (req.path.startsWith('/admin') ? next() : spaCsp(req, res, next)));

// CORS allowlist — the app is normally same-origin (backend serves the built
// frontend), so this only matters for local dev servers and the configured
// production frontend. Never reflect an arbitrary origin.
const allowedOrigins = new Set([FRONTEND_URL, 'http://localhost:3001', 'http://localhost:5173']);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '256kb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // 'auto' asks express-session to set Secure only when the request is
    // actually HTTPS (it trusts req.secure, which respects 'trust proxy'
    // above) — so the cookie is hardened for free the moment a TLS-terminating
    // proxy is put in front of this server, without breaking plain-HTTP dev.
    cookie: { secure: 'auto', sameSite: 'lax', maxAge: 1000 * 60 * 10 }, // 10 min — only for OAuth dance
    // Sessions here are short-lived (OAuth handshake only), but the default
    // MemoryStore never prunes expired entries — a slow, real memory leak over
    // long uptimes. MemoryStore (the npm package) sweeps expired sessions on
    // an interval, closing that leak without adding external infra.
    store: new MemoryStore({ checkPeriod: 1000 * 60 * 15 }),
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
      // skip the network entirely on repeat visits. Everything else (notably
      // index.html, which references those hashed names) must always be
      // revalidated or users would get stuck on a stale build.
      if (filePath.includes(path.join(serveDir, 'assets') + path.sep)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })(req, res, next);
});

// Health check — before all other routes so monitoring can always reach it
app.use('/', require('./routes/health'));

// API routes (all mounted at /api)
app.use('/api', apiLimiter); // floor: every API route is throttled, not just the ones tuned individually
app.use('/api/auth', require('./routes/auth'));
app.use('/api/scan', scanLimiter); // throttle the expensive volume scan
app.use('/api', require('./routes/scan'));
app.use('/api', require('./routes/sectors'));
app.use('/api', require('./routes/chart'));
app.use('/api', require('./routes/watchlist'));
app.use('/api', require('./routes/watchlistAlerts'));
app.use('/api', require('./routes/news'));
app.use('/api', require('./routes/volumeContext'));
app.use('/api', require('./routes/background'));
app.use('/api', require('./routes/stream').router);
app.use('/api', require('./routes/maScanner'));
app.use('/api', require('./routes/scanQuota'));
app.use('/api', require('./routes/push'));
app.use('/api', require('./routes/feedback'));
app.use('/admin', adminLimiter); // admin router is mounted at "/", not "/api" — it needs its own floor
app.use('/', require('./routes/admin'));

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
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
  require('./sentry').Sentry.captureException(err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  require('./sentry').Sentry.captureException(err);
});

startBackgroundScheduler();
startScheduledDigest();

app.listen(PORT, () => {
  console.log(`Volume Scanner running at http://localhost:${PORT}`);
});

module.exports = app;
