// Persisted Capi chat log, per-account, synced across devices. This is also
// the source of truth for conversation memory — services/chatbot.js reads
// it back on every request and feeds it to Gemini as an explicit transcript,
// rather than trusting Gemini's own opaque server-side conversation state.

const db = require('../db');

const MAX_HISTORY = 200;

function safeHistoryLimit(limit) {
  if (limit == null) return MAX_HISTORY;
  const value = Number(limit);
  if (!Number.isFinite(value)) return MAX_HISTORY;
  return Math.max(1, Math.min(MAX_HISTORY, Math.floor(value)));
}

async function getHistory(userId, limit = MAX_HISTORY) {
  // Newest-first LIMIT so a long-running conversation keeps its most recent
  // turns (what memory actually needs), then flipped back to chronological
  // order for display/prompt-building.
  const safeLimit = safeHistoryLimit(limit);
  const rows = await db
    .prepare('SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, safeLimit);
  return rows.reverse();
}

async function addMessage(userId, role, content) {
  await db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(userId, role, content);
}

// Fast-path product answers do not need a model call, so the user and the
// canonical assistant reply can be written together. This is also useful for
// preserving the conversation log when the provider is unavailable.
async function addConversationTurn(userId, userContent, assistantContent) {
  return db.transaction([
    {
      sql: "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)",
      args: [userId, userContent],
    },
    {
      sql: "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'assistant', ?)",
      args: [userId, assistantContent],
    },
  ]);
}

async function clearHistory(userId) {
  await db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(userId);
}

module.exports = { getHistory, addMessage, addConversationTurn, clearHistory };
