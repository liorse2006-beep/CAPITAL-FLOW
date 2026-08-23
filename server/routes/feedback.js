const router = require('express').Router();
const db = require('../db');
const { resolveToken } = require('../middleware/authMiddleware');
const { publicWriteLimiter } = require('../middleware/rateLimiters');
const { reportError } = require('../utils/reportError');

const MAX_MESSAGE_LEN = 2000;
const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
const MAX_EMAIL_BYTES = 254;

// Signed-in or signed-out visitors can both send feedback — auth is read
// opportunistically (to attach a user_id) but never required.
router.post('/feedback', publicWriteLimiter, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > MAX_MESSAGE_LEN) return res.status(400).json({ error: 'Message is too long' });

    const header = req.headers.authorization;
    const user = header && header.startsWith('Bearer ') ? await resolveToken(header.slice(7)) : null;

    const email = user
      ? user.email
      : String(req.body.email || '')
          .trim()
          .slice(0, 254) || null;
    if (email && (Buffer.byteLength(email, 'utf8') > MAX_EMAIL_BYTES || !EMAIL_RE.test(email))) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const page =
      String(req.body.page || '')
        .trim()
        .slice(0, 120) || null;

    await db
      .prepare('INSERT INTO feedback (user_id, email, message, page) VALUES (?, ?, ?, ?)')
      .run(user ? user.id : null, email, message, page);

    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[feedback]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
