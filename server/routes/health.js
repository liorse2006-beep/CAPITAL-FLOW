const express = require('express');
const router  = express.Router();
const db      = require('../db');

router.get('/health', (req, res) => {
  try {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const mode      = db.pragma('journal_mode', { simple: true });
    res.json({
      status:    'ok',
      uptime:    Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
      db:        { status: 'ok', users: count, mode },
    });
  } catch (err) {
    res.status(503).json({
      status:    'error',
      message:   err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
