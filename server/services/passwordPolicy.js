const MIN_PASSWORD_CHARACTERS = 15;
const MAX_PASSWORD_BYTES = 72;
// A local blocklist never sends a customer's password or its hash to a
// third-party breach API. It supplements length and account/IP throttling;
// it is not presented as an exhaustive list of every compromised password.
const COMMON_PASSWORDS = new Set([
  'passwordpassword',
  'password123456789',
  'password1234567890',
  '123456789012345',
  '1234567890123456',
  '12345678901234567890',
  'qwertyuiopasdfgh',
  'qwertyuiop123456',
  'qwerty1234567890',
  'iloveyouiloveyou',
  'letmeinletmein123',
  'capitalflow12345',
]);

function passwordPolicyError(value) {
  if (typeof value !== 'string' || [...value].length < MIN_PASSWORD_CHARACTERS) {
    return `Password must be at least ${MIN_PASSWORD_CHARACTERS} characters`;
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES)
    return `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`;
  if (COMMON_PASSWORDS.has(value.toLowerCase()) || /^(.)\1+$/u.test(value)) return 'Choose a less common password';
  return null;
}

module.exports = { MIN_PASSWORD_CHARACTERS, MAX_PASSWORD_BYTES, passwordPolicyError };
