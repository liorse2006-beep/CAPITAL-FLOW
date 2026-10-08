const crypto = require('crypto');
const { createChallenge, verifySolution } = require('altcha-lib');
const { deriveKey } = require('altcha-lib/algorithms/pbkdf2');

const COOKIE_NAME = 'vs_signup_verification';
const TOKEN_PREFIX = 'altcha:';
const TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 8192;
const COOKIE_RE = /^[a-f0-9]{64}$/;

// Production runs one HTTP worker/instance. Each boot has a new signing key:
// restarting cannot revive a consumed challenge. No secret, third-party call,
// database migration or paid service is required. Horizontal scaling requires
// a shared challenge store before removing the existing single-worker guard.
function createSignupVerification({
  now = Date.now,
  maxChallenges = 2000,
  maxInFlight = 4,
  counter = () => crypto.randomInt(1000, 3001),
} = {}) {
  const signatureSecret = crypto.randomBytes(48).toString('base64url');
  const keySecret = crypto.randomBytes(48).toString('base64url');
  const issued = new Map();
  let inFlight = 0;

  function prune() {
    const time = now();
    for (const [nonce, record] of issued) {
      if (record.expiresAt <= time) issued.delete(nonce);
    }
  }

  function binding(cookie) {
    return crypto.createHash('sha256').update(cookie).digest('hex');
  }

  async function issue(cookie) {
    if (!COOKIE_RE.test(cookie || '')) return null;
    prune();
    if (issued.size + inFlight >= maxChallenges || inFlight >= maxInFlight) return null;
    inFlight++;
    try {
      const expiresAt = now() + TTL_MS;
      const challenge = await createChallenge({
        algorithm: 'PBKDF2/SHA-256',
        cost: 1000,
        counter: counter(),
        deriveKey,
        expiresAt: Math.floor(expiresAt / 1000),
        hmacSignatureSecret: signatureSecret,
        hmacKeySignatureSecret: keySecret,
        data: { purpose: 'signup', binding: binding(cookie) },
      });
      issued.set(challenge.parameters.nonce, { signature: challenge.signature, expiresAt, cookie });
      return challenge;
    } finally {
      inFlight--;
    }
  }

  async function consume(token, cookie) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !token.startsWith(TOKEN_PREFIX)) return false;
    if (!COOKIE_RE.test(cookie || '')) return false;
    prune();
    try {
      const encoded = token.slice(TOKEN_PREFIX.length);
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
      const { challenge, solution } = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      const parameters = challenge?.parameters;
      const record = issued.get(parameters?.nonce);
      if (
        !record ||
        record.cookie !== cookie ||
        record.expiresAt <= now() ||
        challenge.signature !== record.signature ||
        parameters.algorithm !== 'PBKDF2/SHA-256' ||
        parameters.cost !== 1000 ||
        parameters.keyLength !== 32 ||
        parameters.data?.purpose !== 'signup' ||
        parameters.data?.binding !== binding(cookie) ||
        !Number.isInteger(solution?.counter) ||
        solution.counter < 0 ||
        solution.counter > 3000 ||
        typeof solution.derivedKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(solution.derivedKey)
      )
        return false;
      const result = await verifySolution({
        challenge,
        solution,
        deriveKey,
        hmacSignatureSecret: signatureSecret,
        hmacKeySignatureSecret: keySecret,
      });
      // The second check and delete are synchronous. Two concurrent valid
      // submissions cannot both consume the same challenge after awaiting HMAC.
      if (!result.verified || issued.get(parameters.nonce) !== record) return false;
      issued.delete(parameters.nonce);
      return true;
    } catch {
      return false;
    }
  }

  return { issue, consume };
}

const signupVerification = createSignupVerification();
module.exports = { createSignupVerification, signupVerification, COOKIE_NAME, COOKIE_RE, TOKEN_PREFIX, TTL_MS };
