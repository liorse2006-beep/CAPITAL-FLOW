const { fetchWithTimeout } = require('../utils/fetchWithTimeout');

// Two read-only checks, no credentials, login attempts, mail or user sessions.
// A generic 400/401 is not enough: verify the real login-challenge contract
// and independently verify that an anonymous request cannot read an account.
async function checkAuthentication(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const request = async (path) => {
    const response = await fetchWithTimeout(
      baseUrl + path,
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      },
      Math.max(1, deadline - Date.now())
    );
    let json = null;
    try {
      json = await response.json();
    } catch (_) {
      /* malformed response is a failed probe */
    }
    return { response, json };
  };
  const result = (success, statusCode, endpoint, errorMessage = null) => ({
    success,
    statusCode,
    endpoint,
    errorMessage,
    timedOut: false,
    responseMs: null,
    metadata: null,
  });
  const challengePath = '/api/auth/login-challenge';
  const { response, json } = await request(challengePath);
  if (response.status !== 200)
    return result(false, response.status, challengePath, `Login verification returned HTTP ${response.status}.`);
  if (
    !json ||
    json.parameters?.data?.purpose !== 'login' ||
    json.parameters.algorithm !== 'PBKDF2/SHA-256' ||
    typeof json.signature !== 'string' ||
    !json.signature ||
    !/\bvs_login_verification=[a-f0-9]{64}(?:;|$)/.test(response.headers.get('set-cookie') || '')
  )
    return result(false, response.status, challengePath, 'Login verification response was not structurally valid.');
  const accountPath = '/api/auth/me';
  const account = await request(accountPath);
  if (
    account.response.status !== 401 ||
    account.json?.error !== 'Unauthorized' ||
    account.json?.user ||
    account.json?.token
  )
    return result(false, account.response.status, accountPath, 'Anonymous account request was not rejected safely.');
  // Never retain the challenge, cookie, or response body in status diagnostics.
  return result(true, 200, challengePath);
}

module.exports = { checkAuthentication };
