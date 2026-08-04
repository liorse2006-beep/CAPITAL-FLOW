const router = require('express').Router();
const { requirePremium, requirePremiumSSE, issueSseTicket } = require('../middleware/authMiddleware');

// ── Single-instance constraint — read this before scaling horizontally ─────
// `clients`, backgroundCache (services/backgroundScan.js), the per-user scan
// locks (state.js), and the SSE ticket store (authMiddleware.js) all live in
// THIS process's memory, with zero cross-process coordination. That's fine
// running one instance (the only thing this app has ever been deployed as),
// but it silently breaks the moment a second instance is added behind a
// load balancer: broadcastToUser only reaches clients connected to whichever
// instance actually ran the scan, so roughly half of users would stop
// getting live alerts/pushes with no error anywhere telling anyone why.
// Fixing this for real requires a shared pub/sub layer (Redis or similar) —
// there is no such infrastructure provisioned today. Do not scale to
// multiple instances of this app without adding one first.
//
// Active SSE clients — each entry is { res, userId } so alerts can be routed
// to the specific user who owns them, never broadcast across accounts.
const clients = new Set();

// EventSource cannot attach an Authorization header. This endpoint exchanges
// the normal bearer token for a short-lived opaque stream ticket. The ticket
// is safe to place in a URL because it expires quickly and carries no claims.
router.get('/stream-ticket', requirePremium, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ticket: issueSseTicket(req.user.id), expiresIn: 600 });
});

router.get('/stream', requirePremiumSSE, (req, res) => {
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

  send('connected', { ts: Date.now(), clientCount: clients.size });

  // Keep-alive every 25s (below typical 30s proxy timeout)
  const keepAlive = setInterval(() => send('ping', { ts: Date.now() }), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
});

/**
 * Broadcast an SSE event to ALL connected clients. Use only for global,
 * non-personal events (scan status, market-wide notices).
 * Dead connections are pruned automatically.
 */
function broadcast(event, data) {
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

/**
 * Send an SSE event only to the connections owned by a specific user.
 * Used for personal watchlist alerts so thresholds never leak across accounts.
 */
function broadcastToUser(userId, event, data) {
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

function clientCount() {
  return clients.size;
}

module.exports = { router, broadcast, broadcastToUser, clientCount };
