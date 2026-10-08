import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useNotificationDeepLink from './useNotificationDeepLink';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const response = () => ({
  ok: true,
  status: 200,
  json: async () => ({ scanType: 'capitalFlow', results: [{ symbol: 'TEST' }] }),
});
function mount(options, destination = '/scanner?notif=srv-8&campaign=test') {
  const wrapper = ({ children }) => <MemoryRouter initialEntries={[destination]}>{children}</MemoryRouter>;
  return renderHook(
    (props) => {
      useNotificationDeepLink(props);
      return useLocation();
    },
    { initialProps: options, wrapper }
  );
}
function options() {
  return {
    userId: 1,
    isLoading: false,
    authLoadError: false,
    getToken: () => 'synthetic-test-token',
    onNotification: vi.fn(),
  };
}

describe('notification destination recovery', () => {
  it('keeps the destination while session restoration is pending, then opens exactly once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result, rerender } = mount({ ...props, userId: null, isLoading: true });
    expect(result.current.search).toContain('notif=');
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(props);
    await waitFor(() => expect(props.onNotification).toHaveBeenCalledTimes(1));
    expect(result.current.search).toBe('?campaign=test');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/8');
  });
  it('retains the destination for a guest until manual login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result, rerender } = mount({ ...props, userId: null });
    expect(result.current.search).toContain('notif=');
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(props);
    await waitFor(() => expect(props.onNotification).toHaveBeenCalledTimes(1));
  });
  it('does not discard a destination during a transient authentication failure', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = mount({ ...options(), authLoadError: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.search).toContain('notif=');
  });
  it('supports notifications sent before the server-id prefix fix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    mount(props, '/scanner?notif=8');
    await waitFor(() => expect(props.onNotification).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/8');
  });
  it('discards an unsafe id without sending it to the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = mount(options(), '/scanner?notif=../auth');
    await waitFor(() => expect(result.current.search).toBe(''));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not show a previous user response after logout', async () => {
    let resolve;
    const fetchMock = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { rerender } = mount(props);
    rerender({ ...props, userId: null });
    await act(async () => resolve(response()));
    expect(props.onNotification).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('retries a temporary service failure without losing the notification', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const props = options();
    const { result } = mount(props);
    await act(async () => {});
    expect(result.current.search).toContain('notif=');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(props.onNotification).toHaveBeenCalledTimes(1);
    expect(result.current.search).toBe('?campaign=test');
  });
  it('refreshes an expired bearer before loading the persisted result', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const props = { ...options(), refreshSession: vi.fn().mockResolvedValue({ token: 'refreshed-test-token' }) };
    mount(props);
    await waitFor(() => expect(props.onNotification).toHaveBeenCalledTimes(1));
    expect(props.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-test-token');
  });
});
