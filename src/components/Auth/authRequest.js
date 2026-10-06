export const AUTH_REQUEST_TIMEOUT_MS = 30000;

const SAFE_ERRORS = new Map([
  ['Invalid email or password', 'Incorrect email or password. Please try again.'],
  ['An account with this email already exists', 'This email is already registered. Please log in.'],
  ['Please enter a valid email address', 'Please enter a valid email address.'],
  ['Invalid email address', 'Please enter a valid email address.'],
  ['Password must be at least 8 characters', 'Use a password with at least 8 characters.'],
  ['Password must be at most 72 UTF-8 bytes', 'Please use a shorter password.'],
  ['Invalid or expired code', 'This code is invalid or expired. Request a new code.'],
  ['Invalid code', 'This code is invalid. Please try again.'],
  ['Code expired', 'This code has expired. Request a new code.'],
  ['No code found', 'This code has expired. Request a new code.'],
  ['Code already used', 'This code has already been used. Request a new code.'],
  [
    'Too many code attempts. Request a new code and try again later.',
    'Too many attempts. Request a new code and try again later.',
  ],
  ['CAPTCHA verification failed', 'Verification expired or failed. Please verify again.'],
]);

export async function authRequest(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== 'object') {
      const message =
        response.status === 429
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : SAFE_ERRORS.get(data?.error) || 'We could not complete this request. Please try again.';
      const error = new Error(message);
      error.needsVerification = response.status === 403 && data?.needsVerification === true;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request took too long. Please try again.');
    if (error instanceof TypeError) throw new Error('Could not connect. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
