// Persisted Capi chat log — separate from the Gemini conversation-state
// chaining in services/chatbot.js, this is purely "what does the user see
// in their chat history", per-account, across devices.

const db = require('../db');

const MAX_HISTORY = 200;

async function getHistory(userId) {
  return db
    .prepare('SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(userId, MAX_HISTORY);
}

async function addMessage(userId, role, content) {
  await db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(userId, role, content);
}

async function clearHistory(userId) {
  await db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(userId);
  // Also drop the Gemini conversation chain so "clear chat" really starts fresh.
  await db.prepare('UPDATE users SET gemini_interaction_id = NULL WHERE id = ?').run(userId);
}

module.exports = { getHistory, addMessage, clearHistory };
