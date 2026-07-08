// Must be required before any server/ module — sets up a safe, isolated
// environment so tests never touch real secrets or the real user database.
process.env.JWT_SECRET     = 'test-jwt-secret-'.padEnd(32, 'x');
process.env.SESSION_SECRET = 'test-session-secret-'.padEnd(32, 'x');
process.env.DB_PATH        = ':memory:';
process.env.ADMIN_EMAIL    = 'admin@test.local';
