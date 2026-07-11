// Pre-approved emails for the pilot program. A signup matching an allowlisted
// email is automatically tagged is_pilot=1 (see routes/auth.js); admins can
// also flip is_pilot on an existing user directly from the admin panel.
const db = require('../db');

function normalize(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

async function isAllowed(email) {
  const row = await db.prepare('SELECT 1 FROM pilot_allowlist WHERE email = ?').get(normalize(email));
  return !!row;
}

async function addToAllowlist(email) {
  await db.prepare('INSERT OR IGNORE INTO pilot_allowlist (email) VALUES (?)').run(normalize(email));
}

async function removeFromAllowlist(email) {
  await db.prepare('DELETE FROM pilot_allowlist WHERE email = ?').run(normalize(email));
}

async function listAllowlist() {
  return db.prepare('SELECT email, added_at FROM pilot_allowlist ORDER BY added_at DESC').all();
}

module.exports = { isAllowed, addToAllowlist, removeFromAllowlist, listAllowlist };
