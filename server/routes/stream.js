const router = require('express').Router();
const { requireEliteOrTrial, requirePremiumSSE, issueSseTicket } = require('../middleware/authMiddleware');
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

clusterBus.subscribe('sse-broadcast', ({ event, data }) => {
  deliverToAll(event, data);
});
clusterBus.subscribe('sse-broadcast-user', ({ userId, event, data }) => {
  deliverToUser(userId, event, data);
});

function deliverToAll(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  clients.forEach((client) => {
    try {
      client.res.write(payload);
    } catch (e) {
      dead.push(client);
    }
  });
  dead.forEach((c) => clients.delete(c));
}

function deliverToUser(userId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const dead = [];
  clients.forEach((client) => {
    if (client.userId !== userId) return;
    try {
      client.res.write(payload);
    } catch (e) {
      dead.push(client);
    }
  });
  dead.forEach((c) => clients.delete(c));
}

// EventSource cannot attach an Authorization header. This endpoint exchanges
// the normal bearer token for a short-lived opaque stream ticket. The ticket
// is safe to place in a URL because it expires quickly and carries no claims.
router.get('/stream-ticket', requireEliteOrTrial, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ticket: issueSseTicket(req.user.id), expiresIn: 600 });
});

router.get('/stream', sseStreamLimiter, requirePremiumSSE, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const client = { res, userId: req.user.id };
  clients.add(client);

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  };

  // pid identifies which worker this particular connection landed on —
  // harmless to expose (just a process id, reveals nothing about the
  // deployment) and is how the multi-worker integration test proves a
  // broadcast fired by one worker actually reaches a client connected to
  // a different one, instead of trusting that round-robin spread things
  // out without checking.
  send('connected', { ts: Date.now(), clientCount: clients.size, pid: process.pid });

  // Keep-alive every 25s (below typical 30s proxy timeout)
  const keepAlive = setInterval(() => send('ping', { ts: Date.now() }), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
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
  // The real /stream-ticket route is covered separately; keeping this test
  // helper session-free avoids making the local SQLite file stand in for the
  // remote Turso consistency model while the test is exercising SSE relay.
  router.post('/stream/_test-issue-ticket', require('express').json(), async (req, res) => {
    const userId = Number(req.body && req.body.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'userId is required' });
    const db = require('../db');
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json({ ticket: issueSseTicket(user.id) });
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

module.exports = { router, broadcast, broadcastToUser, clientCount };
