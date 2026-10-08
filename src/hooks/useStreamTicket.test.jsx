import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useStreamTicket from './useStreamTicket';

const success = (ticket = 'test-ticket', expiresIn = 600) => ({
  ok: true,
  status: 200,
  json: async () => ({ ticket, expiresIn }),
});
const failure = (status, retryAfter) => ({
  ok: false,
  status,
  headers: { get: () => retryAfter || null },
});
const options = () => ({ enabled: true, userId: 1, getToken: () => 'test-bearer' });
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useStreamTicket recovery', () => {
  it('does not request a ticket until access is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result, rerender } = renderHook((value) => useStreamTicket(value), {
      initialProps: { ...props, enabled: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(props);
    await flush();
    expect(result.current.ticket).toBe('test-ticket');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stream-ticket',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-bearer' },
        credentials: 'same-origin',
      })
    );
  });

  it.each([503, 429])('recovers after HTTP %i rather than silently abandoning renewal', async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(status)).mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    expect(result.current.ticket).toBeNull();
    await advance(30_000);
    expect(result.current.ticket).toBe('test-ticket');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After without an uncontrolled retry loop', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(429, '90')).mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    await advance(89_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(result.current.ticket).toBe('test-ticket');
  });

  it('renews before expiry and recovers from a failed renewal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(success('first'))
      .mockResolvedValueOnce(failure(503))
      .mockResolvedValue(success('replacement'));
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    await advance(480_000);
    expect(result.current.ticket).toBe('first');
    await advance(30_000);
    expect(result.current.ticket).toBe('replacement');
  });

  it('refreshes an expired bearer once through the existing cookie session', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(401)).mockResolvedValue(success());
    const refreshSession = vi.fn().mockResolvedValue({ token: 'refreshed-bearer', status: 'authenticated' });
    vi.stubGlobal('fetch', fetchMock);
    const props = { ...options(), refreshSession };
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-bearer');
    expect(result.current.ticket).toBe('test-ticket');
  });

  it('does not preserve a ticket after an explicit access denial or bypass 403', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(success()).mockResolvedValue(failure(403));
    const refreshSession = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const props = { ...options(), refreshSession };
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    await advance(480_000);
    expect(result.current.ticket).toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers from network failures and invalid successful payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(success('', NaN))
      .mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    await advance(30_000);
    expect(result.current.ticket).toBeNull();
    await advance(60_000);
    expect(result.current.ticket).toBe('test-ticket');
  });

  it('expires an old ticket during a sustained outage instead of reconnecting with it forever', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(success('short-ticket', 60)).mockResolvedValue(failure(503));
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = renderHook(() => useStreamTicket(props));
    await flush();
    expect(result.current.ticket).toBe('short-ticket');
    await advance(60_000);
    expect(result.current.ticket).toBeNull();
  });

  it('aborts a timed-out request and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          })
      )
      .mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = renderHook(() => useStreamTicket(props));
    await advance(15_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await advance(30_000);
    expect(result.current.ticket).toBe('test-ticket');
  });

  it('ignores a late response belonging to the previous account', async () => {
    let finishOld;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValue(success('new-account-ticket'));
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result, rerender } = renderHook((value) => useStreamTicket(value), { initialProps: props });
    rerender({ ...props, userId: 2 });
    await flush();
    expect(result.current.ticket).toBe('new-account-ticket');
    finishOld(success('old-account-ticket'));
    await flush();
    expect(result.current.ticket).toBe('new-account-ticket');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('removes the ticket immediately when access ends and stops pending retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result, rerender } = renderHook((value) => useStreamTicket(value), { initialProps: props });
    await flush();
    rerender({ ...props, enabled: false });
    expect(result.current.ticket).toBeNull();
    await advance(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers when the browser comes online and deduplicates concurrent recovery events', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(503)).mockResolvedValue(success());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result, unmount } = renderHook(() => useStreamTicket(props));
    await flush();
    await advance(5000);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.ticket).toBe('test-ticket');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
    await advance(600_000);
    window.dispatchEvent(new Event('online'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
