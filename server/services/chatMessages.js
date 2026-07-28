// Persisted Capi chat log, per-account, synced across devices. This is also
// the source of truth for conversation memory — services/chatbot.js reads
// it back on every request and feeds it to Gemini as an explicit transcript,
// rather than trusting Gemini's own opaque server-side conversation state.

const db = require('../db');

const MAX_HISTORY = 200;

async function getHistory(userId) {
  // Newest-first LIMIT so a long-running conversation keeps its most recent
  // turns (what memory actually needs), then flipped back to chronological
  // order for display/prompt-building.
  const rows = await db
    .prepare('SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, MAX_HISTORY);
  return rows.reverse();
}

async function addMessage(userId, role, content) {
  await db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(userId, role, content);
}

async function clearHistory(userId) {
  await db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(userId);
}

module.exports = { getHistory, addMessage, clearHistory };
