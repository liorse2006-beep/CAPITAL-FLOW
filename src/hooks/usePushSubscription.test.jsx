import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePushSubscription from './usePushSubscription';

const auth = vi.hoisted(() => ({ user: { id: 11 }, getToken: vi.fn(() => 'synthetic-token-a') }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

const subscription = {
  endpoint: 'https://push.example/synthetic-device',
  keys: { p256dh: 'synthetic-public-key', auth: 'synthetic-auth' },
  unsubscribe: vi.fn(async () => true),
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  auth.user = { id: 11 };
  auth.getToken.mockReturnValue('synthetic-token-a');
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn(async () => subscription) } }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true }) }))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('device push registration is verified for the current account', () => {
  it('does not report enabled when the browser subscription is missing from the server', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
    const { result } = renderHook(() => usePushSubscription());
    let enabled;
    await act(async () => (enabled = await result.current.checkSubscribed()));
    expect(enabled).toBe(false);
    expect(result.current.pushEnabled).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      '/api/push/subscription-status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token-a' }),
      })
    );
  });

  it('only reports enabled after an owner-scoped server confirmation', async () => {
    const { result } = renderHook(() => usePushSubscription());
    await act(async () => expect(await result.current.checkSubscribed()).toBe(true));
    expect(result.current.pushEnabled).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    });
  });

  it('clears a previous enabled indication when server confirmation fails', async () => {
    const { result } = renderHook(() => usePushSubscription());
    await act(async () => result.current.checkSubscribed());
    fetch.mockResolvedValue({ ok: false, status: 503 });
    await act(async () => expect(await result.current.checkSubscribed()).toBe(false));
    expect(result.current.pushEnabled).toBe(false);
  });

  it('does not inherit enabled state or accept a late confirmation after switching accounts', async () => {
    const { result, rerender } = renderHook(() => usePushSubscription());
    await act(async () => result.current.checkSubscribed());
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise);
    let check;
    await act(async () => {
      check = result.current.checkSubscribed();
    });
    auth.user = { id: 22 };
    auth.getToken.mockReturnValue('synthetic-token-b');
    rerender();
    expect(result.current.pushEnabled).toBe(false);
    await act(async () => {
      pending.resolve({ ok: true, json: async () => ({ enabled: true }) });
      await check;
    });
    expect(result.current.pushEnabled).toBe(false);
  });

  it('cannot register an old device under a newly signed-in account after a delayed permission prompt', async () => {
    const permission = deferred();
    Notification.requestPermission.mockReturnValue(permission.promise);
    const { result, rerender } = renderHook(() => usePushSubscription());
    let enabling;
    await act(async () => {
      enabling = result.current.enablePush().catch(() => false);
    });
    auth.user = { id: 22 };
    auth.getToken.mockReturnValue('synthetic-token-b');
    rerender();
    await act(async () => {
      permission.resolve('granted');
      await enabling;
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.pushEnabled).toBe(false);
  });

  it('returns false for a logged-out account without making a registration check', async () => {
    auth.user = null;
    auth.getToken.mockReturnValue(null);
    const { result } = renderHook(() => usePushSubscription());
    await act(async () => expect(await result.current.checkSubscribed()).toBe(false));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears enabled state when browser permission has been revoked', async () => {
    const { result } = renderHook(() => usePushSubscription());
    await act(async () => result.current.checkSubscribed());
    Notification.permission = 'denied';
    await act(async () => expect(await result.current.checkSubscribed()).toBe(false));
    expect(result.current.pushEnabled).toBe(false);
  });

  it('enables only after explicit consent and successful server persistence', async () => {
    const subscribe = vi.fn(async () => subscription);
    navigator.serviceWorker.ready = Promise.resolve({ pushManager: { subscribe } });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'AQID' }) }).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => usePushSubscription());
    await act(async () => result.current.enablePush());
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[1][0]).toBe('/api/push/subscribe');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-token-a');
    expect(result.current.pushEnabled).toBe(true);
    expect(result.current.pushBusy).toBe(false);
  });

  it('does not unsubscribe the shared browser after an account switch during server removal', async () => {
    const pending = deferred();
    fetch.mockReturnValue(pending.promise);
    subscription.unsubscribe.mockClear();
    const { result, rerender } = renderHook(() => usePushSubscription());
    let disabling;
    await act(async () => {
      disabling = result.current.disablePush().catch(() => false);
    });
    auth.user = { id: 22 };
    rerender();
    await act(async () => {
      pending.resolve({ ok: true });
      await disabling;
    });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(result.current.pushEnabled).toBe(false);
  });

  it('shows a friendly error instead of a raw browser failure', async () => {
    Notification.requestPermission.mockRejectedValue(new Error('Internal provider token synthetic-sensitive-value'));
    const { result } = renderHook(() => usePushSubscription());
    await act(async () => {
      await expect(result.current.enablePush()).rejects.toThrow('Could not enable notifications. Please try again.');
    });
    expect(result.current.pushError).not.toContain('synthetic-sensitive-value');
    expect(result.current.pushBusy).toBe(false);
  });

  it('bounds waiting for a service worker that never becomes ready', async () => {
    vi.useFakeTimers();
    navigator.serviceWorker.ready = new Promise(() => {});
    const { result } = renderHook(() => usePushSubscription());
    let check;
    await act(async () => {
      check = result.current.checkSubscribed();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(await check).toBe(false);
    expect(result.current.pushEnabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
