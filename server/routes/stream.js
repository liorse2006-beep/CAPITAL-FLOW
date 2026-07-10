const router = require('express').Router();
const { requirePremiumSSE } = require('../middleware/authMiddleware');

// Active SSE clients — each entry is { res, userId } so alerts can be routed
// to the specific user who owns them, never broadcast across accounts.
const clients = new Set();

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
