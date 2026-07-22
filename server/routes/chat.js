const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { chatLimiter } = require('../middleware/rateLimiters');
const { getHistory, addMessage, clearHistory } = require('../services/chatMessages');
const { askCapi } = require('../services/chatbot');

const MAX_MESSAGE_LEN = 2000;

router.get('/chat/history', requireAuth, async (req, res) => {
  try {
    res.json(await getHistory(req.user.id));
  } catch (err) {
    console.error('[chat/history]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/chat/message', requireAuth, chatLimiter, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > MAX_MESSAGE_LEN) return res.status(400).json({ error: 'Message is too long' });

    await addMessage(req.user.id, 'user', message);
    const reply = await askCapi(req.user.id, message);
    await addMessage(req.user.id, 'assistant', reply);

    res.json({ reply });
  } catch (err) {
    console.error('[chat/message]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/chat/history', requireAuth, async (req, res) => {
  try {
    await clearHistory(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat/history DELETE]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
