const { test } = require('node:test');
const assert = require('node:assert/strict');
const { passwordPolicyError } = require('../server/services/passwordPolicy');

test('new passwords require 15 Unicode characters without forced composition rules', () => {
  for (const input of [undefined, null, {}, 'short-password', '👍'.repeat(14)]) {
    assert.match(passwordPolicyError(input), /15 characters/);
  }
  for (const input of ['a unique long phrase', 'סיסמה ייחודית וארוכה', '👍🙂'.repeat(8), 'longlowercaseonly']) {
    assert.equal(passwordPolicyError(input), null);
  }
});
test('common passwords and bcrypt truncation are rejected, not silently accepted', () => {
  for (const input of ['passwordpassword', 'PASSWORD123456789', 'x'.repeat(20)]) {
    assert.equal(passwordPolicyError(input), 'Choose a less common password');
  }
  assert.match(passwordPolicyError('unique-' + 'a'.repeat(66)), /72 UTF-8 bytes/);
  assert.match(passwordPolicyError('👍🙂'.repeat(10)), /72 UTF-8 bytes/);
});
