import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Turnstile from './Turnstile';
import { getTurnstileSiteKey, TURNSTILE_LOAD_TIMEOUT_MS } from './turnstileConfig';

beforeEach(() => {
  vi.useFakeTimers();
  delete window.turnstile;
  document.getElementById('cf-turnstile-script')?.remove();
});
afterEach(() => {
  cleanup();
  delete window.turnstile;
  document.getElementById('cf-turnstile-script')?.remove();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const siteKey = 'test-public-site-key';
function sdk() {
  window.turnstile = { render: vi.fn(() => 'widget-1'), remove: vi.fn() };
  return window.turnstile;
}

describe('verification lifecycle', () => {
  it('loads in explicit mode and handles a script error with a real retry', () => {
    const onVerify = vi.fn();
    const onExpire = vi.fn();
    render(<Turnstile siteKey={siteKey} onVerify={onVerify} onExpire={onExpire} />);
    const firstScript = document.getElementById('cf-turnstile-script');
    expect(firstScript.src).toContain('?render=explicit');
    fireEvent.error(firstScript);
    expect(screen.getByRole('alert')).toHaveTextContent('could not connect');
    fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
    const replacement = document.getElementById('cf-turnstile-script');
    expect(replacement).not.toBe(firstScript);
    const turnstile = sdk();
    fireEvent.load(replacement);
    act(() => turnstile.render.mock.calls[0][1].callback('verified-token'));
    expect(onVerify).toHaveBeenCalledWith('verified-token');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops waiting for a pre-existing script after a bounded timeout', () => {
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    document.head.appendChild(script);
    render(<Turnstile siteKey={siteKey} onVerify={vi.fn()} onExpire={vi.fn()} />);
    act(() => vi.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS));
    expect(screen.getByRole('alert')).toHaveTextContent('could not connect');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one widget across typing, expiry, and refreshed success; removes it on close', () => {
    const turnstile = sdk();
    const onExpire = vi.fn();
    const { rerender, unmount } = render(<Turnstile siteKey={siteKey} onVerify={vi.fn()} onExpire={onExpire} />);
    const options = turnstile.render.mock.calls[0][1];
    act(() => options['expired-callback']());
    rerender(<Turnstile siteKey={siteKey} onVerify={vi.fn()} onExpire={onExpire} />);
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('expired');
    act(() => options.callback('refreshed-token'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
  });

  it('invalidates successful verification when the provider later reports an error or timeout', () => {
    const turnstile = sdk();
    const onExpire = vi.fn();
    render(<Turnstile siteKey={siteKey} onVerify={vi.fn()} onExpire={onExpire} />);
    const options = turnstile.render.mock.calls[0][1];
    act(() => options.callback('verified-token'));
    onExpire.mockClear();
    act(() => options['error-callback']('200500'));
    expect(onExpire).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).not.toHaveTextContent('200500');
    act(() => options['timeout-callback']());
    expect(screen.getByRole('alert')).toHaveTextContent('expired');
  });

  it('uses compact verification for the smallest mobile screens', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const turnstile = sdk();
    render(<Turnstile siteKey={siteKey} onVerify={vi.fn()} onExpire={vi.fn()} />);
    expect(turnstile.render.mock.calls[0][1].size).toBe('compact');
    delete window.matchMedia;
  });

  it('does not render an unconfigured widget or substitute a dummy production key', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(getTurnstileSiteKey()).toBe('');
    const turnstile = sdk();
    render(<Turnstile onVerify={vi.fn()} onExpire={vi.fn()} />);
    expect(turnstile.render).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ' real-public-key\n');
    expect(getTurnstileSiteKey()).toBe('real-public-key');
  });

  it('ignores late script loads after the form closes', () => {
    const onVerify = vi.fn();
    const { unmount } = render(<Turnstile siteKey={siteKey} onVerify={onVerify} onExpire={vi.fn()} />);
    const script = document.getElementById('cf-turnstile-script');
    unmount();
    const turnstile = sdk();
    fireEvent.load(script);
    expect(turnstile.render).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
