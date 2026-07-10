// Pre-approved emails for the pilot program. A signup matching an allowlisted
// email is automatically tagged is_pilot=1 (see routes/auth.js); admins can
// also flip is_pilot on an existing user directly from the admin panel.
const db = require('../db');

function normalize(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isAllowed(email) {
  const row = db.prepare('SELECT 1 FROM pilot_allowlist WHERE email = ?').get(normalize(email));
  return !!row;
}

function addToAllowlist(email) {
  db.prepare('INSERT OR IGNORE INTO pilot_allowlist (email) VALUES (?)').run(normalize(email));
}

function removeFromAllowlist(email) {
  db.prepare('DELETE FROM pilot_allowlist WHERE email = ?').run(normalize(email));
}

function listAllowlist() {
  return db.prepare('SELECT email, added_at FROM pilot_allowlist ORDER BY added_at DESC').all();
}

module.exports = { isAllowed, addToAllowlist, removeFromAllowlist, listAllowlist };
