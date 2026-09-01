const router = require('express').Router();
const { requireEliteOrTrial } = require('../middleware/authMiddleware');
const { chatLimiter } = require('../middleware/rateLimiters');
const { getHistory, addMessage, addConversationTurn, clearHistory } = require('../services/chatMessages');
const { askCapiForMessage, streamCapi, getFastCapiReply, CAPI_UNAVAILABLE_REPLY } = require('../services/chatbot');
const { reportError } = require('../utils/reportError');

const MAX_MESSAGE_LEN = 2000;

function readMessage(req, res) {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return null;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ error: 'Message is too long' });
    return null;
  }
  return message;
}

function beginSse(res) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

// Writes one small SSE frame and respects backpressure. The browser receives
// only typed events, never provider diagnostics or raw provider payloads.
function writeSse(res, event, payload) {
  if (res.writableEnded || res.destroyed) return Promise.resolve(false);
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  try {
    const writable = res.write(frame);
    if (typeof res.flush === 'function') res.flush();
    if (writable) return Promise.resolve(true);
    return new Promise((resolve) => {
      const cleanup = () => {
        res.removeListener('drain', onDrain);
        res.removeListener('close', onClose);
      };
      const onDrain = () => {
        cleanup();
        resolve(true);
      };
      const onClose = () => {
        cleanup();
        resolve(false);
      };
      res.once('drain', onDrain);
      res.once('close', onClose);
    });
  } catch {
    return Promise.resolve(false);
  }
}

// Capi is an Elite feature, opened up in full during the 7-day free trial —
// every route here requires Elite OR an in-trial free account, matching the
// frontend's own gate on rendering the chat launcher.
router.get('/chat/history', requireEliteOrTrial, async (req, res) => {
  try {
    res.json(await getHistory(req.user.id));
  } catch (err) {
    reportError(err, '[chat/history]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/chat/message', requireEliteOrTrial, chatLimiter, async (req, res) => {
  try {
    const message = readMessage(req, res);
    if (!message) return;

    // Exact, canonical product answers do not need a metered model call. The
    // two rows are written atomically so the fast path is both quick and
    // durable.
    const fastReply = getFastCapiReply(message);
    if (fastReply) {
      await addConversationTurn(req.user.id, message, fastReply);
      return res.json({ reply: fastReply });
    }

    await addMessage(req.user.id, 'user', message);
    const reply = await askCapiForMessage(req.user.id, message);
    await addMessage(req.user.id, 'assistant', reply);

    res.json({ reply });
  } catch (err) {
    reportError(err, '[chat/message]');
    res.status(500).json({ error: 'Server error' });
  }
});

// Streaming variant used by the current widget. The original JSON endpoint
// above remains available for older clients and integrations.
router.post('/chat/message/stream', requireEliteOrTrial, chatLimiter, async (req, res) => {
  const message = readMessage(req, res);
  if (!message) return;

  beginSse(res);
  const abortController = new AbortController();
  let clientClosed = false;
  let userPersisted = false;
  let assistantPersisted = false;

  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort();
    }
  });

  try {
    const readyWritten = await writeSse(res, 'ready', { status: 'connected' });
    if (!readyWritten || clientClosed) return;

    const fastReply = getFastCapiReply(message);
    if (fastReply) {
      await addConversationTurn(req.user.id, message, fastReply);
      userPersisted = true;
      assistantPersisted = true;
      await writeSse(res, 'delta', { text: fastReply });
      await writeSse(res, 'complete', { reply: fastReply });
      return;
    }

    await addMessage(req.user.id, 'user', message);
    userPersisted = true;

    const result = await streamCapi(
      req.user.id,
      message,
      async (text) => {
        const written = await writeSse(res, 'delta', { text });
        if (!written) throw new Error('Capi client disconnected');
      },
      abortController.signal
    );
    await addMessage(req.user.id, 'assistant', result.reply);
    assistantPersisted = true;

    if (result.ok) {
      await writeSse(res, 'complete', { reply: result.reply });
    } else {
      // If a provider stream emitted partial text and then failed, the client
      // replaces that partial bubble with this complete, honest fallback.
      await writeSse(res, 'error', { reply: result.reply });
    }
  } catch (err) {
    reportError(err, '[chat/message/stream]');
    if (userPersisted && !assistantPersisted) {
      await addMessage(req.user.id, 'assistant', CAPI_UNAVAILABLE_REPLY).catch((persistErr) =>
        reportError(persistErr, '[chat/message/stream fallback persistence]')
      );
    }
    if (!clientClosed) await writeSse(res, 'error', { reply: CAPI_UNAVAILABLE_REPLY });
  } finally {
    if (!res.writableEnded && !res.destroyed) res.end();
  }
});

router.delete('/chat/history', requireEliteOrTrial, async (req, res) => {
  try {
    await clearHistory(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    reportError(err, '[chat/history DELETE]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
