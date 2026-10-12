import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_REQUEST_TIMEOUT_MS, authRequest } from './authRequest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('does not expose proxy HTML, raw errors, or provider details to the customer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected HTML with internal details');
      },
    })
  );
  await expect(authRequest('signup', {})).rejects.toThrow("We couldn't complete your request. Please try again.");
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Database error at internal-host; provider token secret' }),
    })
  );
  await expect(authRequest('login', {})).rejects.toThrow("We couldn't complete your request. Please try again.");
});

it('keeps structured verification-required information without depending on English error text', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ needsVerification: true, error: 'An email code is required' }),
    })
  );
  await expect(authRequest('login', {})).rejects.toMatchObject({ needsVerification: true });
});

it('aborts a stalled request instead of leaving signup busy forever', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    )
  );
  const assertion = expect(authRequest('signup', {})).rejects.toThrow('took too long');
  await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it('shows the new password policy without disclosing internal failures', async () => {
  for (const [error, expected] of [
    ['Password must be at least 15 characters', '15 characters'],
    ['Choose a less common password', 'less common'],
    ['Password must be at most 72 UTF-8 bytes', 'shorter password'],
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error }) }));
    await expect(authRequest('signup', {})).rejects.toThrow(expected);
  }
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('internal host secret')));
  await expect(authRequest('login', {})).rejects.toThrow("We couldn't connect. Check your connection and try again.");
});
