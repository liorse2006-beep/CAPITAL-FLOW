const db = require('../db');

// Serialize capacity-increasing child writes on the existing owner row.
async function withUserWrite(userId, callback) {
  return db.transaction(async (tx) => {
    const owner = await tx
      .prepare('SELECT id, is_blocked FROM users WHERE id = ?' + (db.dialect === 'postgres' ? ' FOR UPDATE' : ''))
      .get(userId);
    if (!owner || owner.is_blocked) throw new Error('Account is not available');
    return callback(tx);
  });
}

module.exports = { withUserWrite };
