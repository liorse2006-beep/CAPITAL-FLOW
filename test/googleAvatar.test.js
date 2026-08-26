// Regression coverage for Google profile-photo handling. These tests only
// validate local parsing/serialization and never contact Google or mutate a
// production account.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getGoogleAvatarUrl, serializePublicUser } = require('../server/routes/auth');

test('accepts an HTTPS Google-hosted profile photo URL', () => {
  const profile = {
    photos: [{ value: 'https://lh3.googleusercontent.com/a/avatar=s96-c' }],
  };

  assert.equal(getGoogleAvatarUrl(profile), profile.photos[0].value);
});

test('rejects avatar URLs that are not an allowed Google HTTPS host', () => {
  const invalidValues = [
    'http://lh3.googleusercontent.com/a/avatar=s96-c',
    'https://googleusercontent.com/a/avatar=s96-c',
    'https://lh3.googleusercontent.com.evil.example/a/avatar=s96-c',
    'https://avatars.example.com/user/avatar.png',
    'not-a-url',
  ];

  for (const value of invalidValues) {
    assert.equal(getGoogleAvatarUrl({ photos: [{ value }] }), null, value);
  }
});

test('returns null when Google does not provide a profile photo', () => {
  assert.equal(getGoogleAvatarUrl({}), null);
  assert.equal(getGoogleAvatarUrl({ photos: [] }), null);
  assert.equal(getGoogleAvatarUrl(null), null);
});

test('public user serialization includes the avatar and excludes secrets', () => {
  const avatarUrl = 'https://lh5.googleusercontent.com/a/avatar=s96-c';
  const publicUser = serializePublicUser({
    id: 42,
    email: 'investor@example.com',
    google_id: 'google-user-id',
    google_email: 'investor@example.com',
    avatar_url: avatarUrl,
    password_hash: 'must-not-leak',
    tier: 'free',
  });

  assert.equal(publicUser.avatar_url, avatarUrl);
  assert.equal(publicUser.auth_provider, 'Google');
  assert.equal('password_hash' in publicUser, false);
  assert.equal('google_id' in publicUser, false);
});
