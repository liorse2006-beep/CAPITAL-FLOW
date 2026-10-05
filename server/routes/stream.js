const router = require('express').Router();
const {
  requireEliteOrTrial,
  requirePremiumSSE,
  issueSseTicket,
  resolveStreamAccess,
} = require('../middleware/authMiddleware');
const { verifyToken } = require('../services/auth');
const { sseStreamLimiter } = require('../middleware/rateLimiters');
const clusterBus = require('../services/clusterBus');

// Active SSE clients THIS worker is directly holding the connection for —
// each entry is { res, userId } so alerts can be routed to the specific
// user who owns them, never broadcast across accounts. broadcast()/
// broadcastToUser() below publish over clusterBus rather than writing to
// `clients` directly, so a scan/alert that happened on a different worker
// still reaches whichever worker is holding a given user's connection —
// see clusterBus.js for why that distinction matters once there's more
// than one worker.
const clients = new Set();
const MAX_STREAMS_PER_SESSION = 2;
const MAX_STREAMS_PER_USER = 4;
const MAX_STREAMS_PER_WORKER = 200;
const MAX_CLIENT_QUEUE_BYTES = 512 * 1024;
const MAX_WORKER_QUEUE_BYTES = 8 * 1024 * 1024;
const DRAIN_TIMEOUT_MS = 10000;
const ACCESS_TIMEOUT_MS = 8000;
const runAccessCheck = require('../services/boundedQueue').createBoundedQueue({
  concurrency: 16,
  maxWaiting: MAX_STREAMS_PER_WORKER,
  waitTimeoutMs: ACCESS_TIMEOUT_MS,
});
let queuedBytes = 0;
const accessChecks = new Map();
let closing = false;

function closeClient(client, gracefully = false) {
  if (client.closed) return;
  client.closed = true;
  clearInterval(client.keepAlive);
  clearTimeout(client.expires);
  queuedBytes -= client.bytes;
  client.bytes = 0;
  client.queue.length = 0;
  clients.delete(client);
  client.cancelDrain?.();
  if (gracefully) client.res.end();
  else client.res.destroy();
}

// Event streams are deliberately long-lived; HTTP server.close() alone
// cannot drain them. End existing streams and refuse late admissions while
// the instance restarts. Stored notifications remain available on reconnect.
function closeAllStreams() {
  closing = true;
  for (const client of clients) closeClient(client, true);
}

function checkAccess(client) {
  const key = `${client.userId}:${client.sessionId}`;
  if (accessChecks.has(key)) return accessChecks.get(key);
  let timer;
  let active = true;
  const query = runAccessCheck(() =>
    active && !client.closed ? resolveStreamAccess(client.userId, client.sessionId) : null
  );
  const promise = Promise.race([
    query,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ACCESS_TIMEOUT_MS);
      timer.unref();
    }),
  ]).finally(() => {
    active = false;
    clearTimeout(timer);
    if (accessChecks.get(key) === promise) accessChecks.delete(key);
  });
  accessChecks.set(key, promise);
  return promise;
}

function waitForDrain(client) {
  return new Promise((resolve) => {
    const done = (ok = false) => {
      clearTimeout(timer);
      client.res.off('drain', onDrain);
      client.cancelDrain = null;
      resolve(ok);
    };
    const onDrain = () => done(true);
    const timer = setTimeout(done, DRAIN_TIMEOUT_MS);
    timer.unref();
    client.cancelDrain = done;
    client.res.once('drain', onDrain);
    if (client.closed) done();
  });
}

async function drainClient(client) {
  if (client.draining || client.closed) return;
  client.draining = true;
  try {
    while (!client.closed && client.queue.length) {
      // Do not cache a prior admission decision for protected deliveries.
      // This also detects revocations on independent replicas and trial expiry.
      if (client.queue[0].protected && !(await checkAccess(client))) return closeClient(client);
      if (client.closed) return;
      const item = client.queue.shift();
      if (!client.res.write(item.payload) && !(await waitForDrain(client))) return closeClient(client);
      if (!client.closed) {
        client.bytes -= item.bytes;
        queuedBytes -= item.bytes;
      }
    }
  } catch {
    closeClient(client);
  } finally {
    client.draining = false;
  }
}

function enqueue(client, payload, protectedDelivery = true) {
  if (client.closed) return;
  const bytes = Buffer.byteLength(payload);
  if (
    client.bytes + bytes > MAX_CLIENT_QUEUE_BYTES ||
    queuedBytes + bytes > MAX_WORKER_QUEUE_BYTES ||
    client.res.writableLength + bytes > MAX_CLIENT_QUEUE_BYTES
  )
    return closeClient(client);
  client.queue.push({ payload, bytes, protected: protectedDelivery });
  client.bytes += bytes;
  queuedBytes += bytes;
  void drainClient(client);
}

function closeForUser(userId, sessionId) {
  for (const client of clients) {
    if (
      Number(client.userId) === Number(userId) &&
      (sessionId == null || Number(client.sessionId) === Number(sessionId))
    )
      closeClient(client);
  }
}
clusterBus.subscribe('auth:session-revoked', ({ userId, sessionId }) => closeForUser(userId, sessionId));
clusterBus.subscribe('auth:user-sessions-revoked', ({ userId }) => closeForUser(userId));
clusterBus.subscribe('auth:user-entitlement-changed', ({ userId }) => closeForUser(userId));

clusterBus.subscribe('sse-broadcast', ({ event, data }) => {
  deliverToAll(event, data);
});
clusterBus.subscribe('sse-broadcast-user', ({ userId, event, data }) => {
  deliverToUser(userId, event, data);
});

function deliverToAll(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => enqueue(client, payload));
}

function deliverToUser(userId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => {
    if (Number(client.userId) === Number(userId)) enqueue(client, payload);
  });
}

// EventSource cannot attach an Authorization header. This endpoint exchanges
// the normal bearer token for a short-lived opaque stream ticket. The ticket
// is safe to place in a URL because it expires quickly and carries no claims.
router.get('/stream-ticket', requireEliteOrTrial, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const payload = verifyToken(req.headers.authorization.slice(7));
  if (!Number.isSafeInteger(Number(payload.sid)) || Number(payload.sid) <= 0) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  res.json({ ticket: issueSseTicket(req.user.id, Number(payload.sid)), expiresIn: 600 });
});

router.get('/stream', sseStreamLimiter, requirePremiumSSE, (req, res) => {
  if (closing) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ error: 'Capital Flow is restarting. Please try again shortly.' });
  }
  const userStreams = [...clients].filter((client) => client.userId === req.user.id);
  if (
    clients.size >= MAX_STREAMS_PER_WORKER ||
    userStreams.length >= MAX_STREAMS_PER_USER ||
    userStreams.filter((client) => client.sessionId === req.streamSessionId).length >= MAX_STREAMS_PER_SESSION
  )
    return res.status(429).json({ error: 'Too many active connections. Close another tab and try again.' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const client = {
    res,
    userId: req.user.id,
    sessionId: req.streamSessionId,
    closed: false,
    queue: [],
    bytes: 0,
    draining: false,
    keepAlive: null,
    cancelDrain: null,
  };
  clients.add(client);

  const send = (event, data) => enqueue(client, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // pid identifies which worker this particular connection landed on —
  // harmless to expose (just a process id, reveals nothing about the
  // deployment) and is how the multi-worker integration test proves a
  // broadcast fired by one worker actually reaches a client connected to
  // a different one, instead of trusting that round-robin spread things
  // out without checking.
  send('connected', { ts: Date.now(), clientCount: clients.size, pid: process.pid });

  // Keep-alive every 25s (below typical 30s proxy timeout)
  // Heartbeats carry no account/market data. Avoid thousands of idle DB
  // reads per device; protected events still recheck the durable permission.
  client.keepAlive = setInterval(() => enqueue(client, `event: ping\ndata: {"ts":${Date.now()}}\n\n`, false), 25000);
  client.keepAlive.unref();
  client.expires = setTimeout(() => closeClient(client), Math.max(1, req.streamExpiresAt - Date.now()));
  client.expires.unref();
  req.on('close', () => closeClient(client));
  res.on('close', () => closeClient(client));
  res.on('error', () => closeClient(client));
});

// Test-only, strictly gated: exercises the exact same broadcastToUser()
// every real alert path calls (background scan matches, watchlist
// thresholds), from an HTTP request, so the multi-worker integration test
// (test/cluster.integration.test.js) can prove a broadcast issued while
// handling ONE request reaches a client whose /stream connection landed on
// a DIFFERENT worker — without needing to drive an entire real scan through
// the cluster to get there. NODE_ENV is never 'test' outside the test
// suite/CI (Render runs with NODE_ENV=production — see server/config.js),
// so this route does not exist in any real deployment.
if (process.env.NODE_ENV === 'test') {
  router.post('/stream/_test-broadcast', require('express').json(), (req, res) => {
    const { userId, event, data } = req.body || {};
    if (userId) broadcastToUser(userId, event, data);
    else broadcast(event, data);
    res.json({ ok: true });
  });

  // Seeds a real elite user + real session (via the actual issueToken —
  // the same code path login uses) using THIS worker's own already-open DB
  // connection. The multi-worker integration test needs a user to exist
  // before it can request an SSE ticket, but its own separate process
  // opening a third connection to the same local SQLite file (on top of
  // both workers' own connections) hits SQLITE_BUSY under real concurrent
  // load — a local-file-mode limitation, not something real (remote,
  // client/server) Turso has. Routing the seed through a worker's existing
  // connection sidesteps that without changing anything about how the app
  // itself talks to the database.
  router.post('/stream/_test-seed-user', require('express').json(), async (req, res) => {
    const db = require('../db');
    const { issueToken } = require('../services/auth');
    const email = (req.body && req.body.email) || 'cluster-it-user@test.local';
    const result = await db
      .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
      .run(email);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    const { accessToken } = await issueToken(user);
    res.json({ userId: user.id, accessToken });
  });

  // The cluster integration test uses a direct signed ticket after seeding.
  // The helper still binds that ticket to the session created by the actual
  // issueToken path, so the integration test exercises the same revocation
  // boundary as production without exposing the helper in real deployments.
  router.post('/stream/_test-issue-ticket', require('express').json(), async (req, res) => {
    const userId = Number(req.body && req.body.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'userId is required' });
    const db = require('../db');
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const session = await db
      .prepare('SELECT id FROM user_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(user.id);
    if (!session) return res.status(409).json({ error: 'user has no active session' });
    res.json({ ticket: issueSseTicket(user.id, Number(session.id)) });
  });

  router.get('/stream/_test-worker-pid', (req, res) => {
    res.json({ pid: process.pid });
  });
}

/**
 * Broadcast an SSE event to ALL connected clients across every worker. Use
 * only for global, non-personal events (scan status, market-wide notices).
 * Dead connections are pruned automatically on whichever worker holds them.
 */
function broadcast(event, data) {
  clusterBus.publish('sse-broadcast', { event, data });
}

/**
 * Send an SSE event only to the connections owned by a specific user,
 * wherever in the cluster they're connected. Used for personal watchlist
 * alerts so thresholds never leak across accounts.
 */
function broadcastToUser(userId, event, data) {
  clusterBus.publish('sse-broadcast-user', { userId, event, data });
}

// This worker's own connected-client count only — informational (sent in
// the 'connected' event so a client can see roughly how busy things are),
// not a cluster-wide total, and nothing server-side depends on it being one.
function clientCount() {
  return clients.size;
}

module.exports = { router, broadcast, broadcastToUser, clientCount, closeAllStreams };
