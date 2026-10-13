import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasCriticalFlow, installStaleChunkRecovery, RECOVERY_KEY } from './staleChunkRecovery';
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.innerHTML = '';
});
function importFailure(message = 'Failed to fetch dynamically imported module: /assets/old-screen.js') {
  const event = new Event('vite:preloadError', { cancelable: true });
  Object.defineProperty(event, 'payload', { value: new TypeError(message) });
  return event;
}
function setup(options = {}) {
  const target = new EventTarget();
  const reload = vi.fn();
  const stop = installStaleChunkRecovery({ target, reload, version: 'bundle-a.js', ...options });
  return { target, reload, stop };
}
describe('stale deployment chunk recovery', () => {
  it('can install even when reading the browser sessionStorage property is blocked', () => {
    const getter = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked property');
    });
    const { target, reload, stop } = setup();
    expect(() => target.dispatchEvent(importFailure())).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
    stop();
    getter.mockRestore();
  });
  it('reloads exactly once per bundle and never persists the failed URL or user information', () => {
    const { target, reload, stop } = setup();
    const first = importFailure('Failed to fetch dynamically imported module: /assets/old.js?private=do-not-store');
    target.dispatchEvent(first);
    target.dispatchEvent(importFailure());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    expect(sessionStorage.getItem(RECOVERY_KEY)).toBe('bundle-a.js');
    stop();
    const next = setup({ version: 'bundle-b.js' });
    next.target.dispatchEvent(importFailure());
    expect(next.reload).toHaveBeenCalledTimes(1);
    next.stop();
  });
  it.each(['Failed to fetch /api/scan', 'Unauthorized', 'Internal Server Error', 'render failed'])(
    'never reloads for an ordinary API/render error: %s',
    (message) => {
      const { target, reload, stop } = setup();
      const event = importFailure(message);
      target.dispatchEvent(event);
      expect(reload).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      stop();
    }
  );
  it.each([
    '<div role="dialog"></div>',
    '<div aria-modal="true"></div>',
    '<input type="password">',
    '<input autocomplete="one-time-code">',
  ])('protects an active account/payment/input flow: %s', (markup) => {
    document.body.innerHTML = markup;
    expect(hasCriticalFlow()).toBe(true);
    const { target, reload, stop } = setup();
    target.dispatchEvent(importFailure());
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
  it('protects a pending Google confirmation before its lazy dialog has mounted', () => {
    const { target, reload, stop } = setup({ canReload: () => false });
    target.dispatchEvent(importFailure());
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
  it('does not refresh offline, with blocked storage, or after cleanup', () => {
    for (const options of [
      { isOnline: () => false },
      {
        storage: {
          getItem() {
            throw new Error('blocked');
          },
        },
      },
    ]) {
      const { target, reload, stop } = setup(options);
      target.dispatchEvent(importFailure());
      expect(reload).not.toHaveBeenCalled();
      stop();
    }
    const disposed = setup();
    disposed.stop();
    disposed.target.dispatchEvent(importFailure());
    expect(disposed.reload).not.toHaveBeenCalled();
  });
  it('leaves ordinary recovery available if navigation throws', () => {
    const { target, stop } = setup({
      reload() {
        throw new Error('not navigated');
      },
    });
    const event = importFailure();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(RECOVERY_KEY)).toBeNull();
    stop();
  });
});
