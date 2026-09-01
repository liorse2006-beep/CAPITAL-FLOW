// The Google OAuth flow must bind its callback to the signed cookie-session.
// This is a local contract test only: it never opens Google OAuth or makes a
// network request.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const authRouter = require('../server/routes/auth');

test('Google OAuth authorization and callback both require Passport state verification', () => {
  assert.equal(authRouter.GOOGLE_AUTH_OPTIONS.state, true);
  assert.deepEqual(authRouter.GOOGLE_AUTH_OPTIONS.scope, ['profile', 'email']);
  assert.equal(authRouter.GOOGLE_CALLBACK_AUTH_OPTIONS.state, true);
  assert.equal(authRouter.GOOGLE_CALLBACK_AUTH_OPTIONS.session, false);
});
