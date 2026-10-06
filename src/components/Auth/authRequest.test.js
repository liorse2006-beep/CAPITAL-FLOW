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
  await expect(authRequest('signup', {})).rejects.toThrow('We could not complete this request');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Database error at internal-host; provider token secret' }),
    })
  );
  await expect(authRequest('login', {})).rejects.toThrow('We could not complete this request');
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
