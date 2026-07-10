const router = require('express').Router();
const db = require('../db');
const { resolveToken } = require('../middleware/authMiddleware');

const MAX_MESSAGE_LEN = 2000;

// Signed-in or signed-out visitors can both send feedback — auth is read
// opportunistically (to attach a user_id) but never required.
router.post('/feedback', (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (message.length > MAX_MESSAGE_LEN) return res.status(400).json({ error: 'Message is too long' });

  const header = req.headers.authorization;
  const user = header && header.startsWith('Bearer ') ? resolveToken(header.slice(7)) : null;

  const email = user ? user.email : String(req.body.email || '').trim().slice(0, 254) || null;
  const page = String(req.body.page || '').trim().slice(0, 120) || null;

  db.prepare('INSERT INTO feedback (user_id, email, message, page) VALUES (?, ?, ?, ?)').run(
    user ? user.id : null,
    email,
    message,
    page
  );

  res.json({ ok: true });
});

module.exports = router;
