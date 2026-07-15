const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/health', async (req, res) => {
  try {
    await db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
      db: { status: 'ok' },
    });
  } catch (err) {
    console.error('[health]', err);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
