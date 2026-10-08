import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAccountOperation from './useAccountOperation';

afterEach(() => {
  vi.useRealTimers();
});

describe('account operation ownership', () => {
  it('aborts and invalidates all pending operations when the owner changes', () => {
    const getToken = () => 'synthetic-token';
    const view = renderHook(({ owner }) => useAccountOperation(getToken, owner), { initialProps: { owner: 1 } });
    const operation = view.result.current('export');
    expect(operation.canCommit()).toBe(true);
    view.rerender({ owner: 2 });
    expect(operation.signal.aborted).toBe(true);
    expect(operation.isCurrent()).toBe(false);
    const next = view.result.current('export');
    operation.finish();
    expect(view.result.current('export')).toBeNull();
    next.finish();
  });

  it('does not permit callbacks after token rotation', () => {
    let token = 'synthetic-old-token';
    const view = renderHook(() => useAccountOperation(() => token, 1));
    const operation = view.result.current('password');
    token = 'synthetic-other-token';
    expect(operation.canCommit()).toBe(false);
    operation.finish();
  });

  it('bounds requests to thirty seconds without changing account ownership', () => {
    vi.useFakeTimers();
    const view = renderHook(() => useAccountOperation(() => 'synthetic-token', 1));
    const operation = view.result.current('password');
    act(() => vi.advanceTimersByTime(30000));
    expect(operation.signal.aborted).toBe(true);
    expect(operation.canCommit()).toBe(false);
    expect(operation.isCurrent()).toBe(true);
    operation.finish();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deduplicates the same operation and clears its timers on unmount', () => {
    vi.useFakeTimers();
    const view = renderHook(() => useAccountOperation(() => 'synthetic-token', 1));
    const operation = view.result.current('delete');
    expect(view.result.current('delete')).toBeNull();
    view.unmount();
    expect(operation.signal.aborted).toBe(true);
    expect(operation.isCurrent()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
