const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const { chatLimiter } = require('../middleware/rateLimiters');
const { getHistory, addMessage, clearHistory } = require('../services/chatMessages');
const { askCapi } = require('../services/chatbot');

const MAX_MESSAGE_LEN = 2000;

// Capi is an Elite feature, opened up in full during the 7-day free trial —
// every route here requires Elite OR an in-trial free account, matching the
// frontend's own gate on rendering the chat launcher.
router.get('/chat/history', requireEliteOrTrial, async (req, res) => {
  try {
    res.json(await getHistory(req.user.id));
  } catch (err) {
    console.error('[chat/history]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/chat/message', requireEliteOrTrial, chatLimiter, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > MAX_MESSAGE_LEN) return res.status(400).json({ error: 'Message is too long' });

    await addMessage(req.user.id, 'user', message);
    const reply = await askCapi(req.user.id);
    await addMessage(req.user.id, 'assistant', reply);

    res.json({ reply });
  } catch (err) {
    console.error('[chat/message]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/chat/history', requireEliteOrTrial, async (req, res) => {
  try {
    await clearHistory(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat/history DELETE]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
