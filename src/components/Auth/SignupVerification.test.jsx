import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('altcha/external', () => {
  window.$altcha = { algorithms: registry };
  return {};
});
vi.mock('altcha/workers/pbkdf2?worker', () => ({ default: class Worker {} }));
import SignupVerification from './SignupVerification';

beforeAll(() => {
  if (!customElements.get('altcha-widget')) {
    customElements.define(
      'altcha-widget',
      class extends HTMLElement {
        configure = vi.fn();
        reset = vi.fn();
        getState = () => this.state || 'unverified';
      }
    );
  }
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function event(widget, type, detail) {
  act(() => widget.dispatchEvent(new CustomEvent(type, { detail })));
}

it('uses only the same-origin challenge and explicit workers, with no production test bypass', () => {
  const onVerify = vi.fn(),
    onExpire = vi.fn();
  render(<SignupVerification onVerify={onVerify} onExpire={onExpire} />);
  const widget = document.querySelector('altcha-widget');
  expect(JSON.parse(widget.getAttribute('configuration'))).toEqual(
    expect.objectContaining({
      challenge: '/api/auth/signup-challenge',
      credentials: 'same-origin',
      auto: 'onload',
      workers: 2,
    })
  );
  expect(widget.configure).not.toHaveBeenCalled();
  expect(JSON.parse(widget.getAttribute('configuration')).test).toBeUndefined();
  expect(registry.set).toHaveBeenCalledWith('PBKDF2/SHA-256', expect.any(Function));
  event(widget, 'verified', { payload: 'real-sdk-payload' });
  expect(onVerify).toHaveBeenCalledWith('altcha:real-sdk-payload');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('invalidates an expired proof and retries with a fresh widget', () => {
  const onVerify = vi.fn(),
    onExpire = vi.fn();
  render(<SignupVerification onVerify={onVerify} onExpire={onExpire} />);
  const old = document.querySelector('altcha-widget');
  event(old, 'statechange', { state: 'expired' });
  expect(onExpire).toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not verify');
  fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
  expect(document.querySelector('altcha-widget')).not.toBe(old);
  expect(old.reset).toHaveBeenCalled();
  event(old, 'verified', { payload: 'stale' });
  expect(onVerify).not.toHaveBeenCalled();
  event(document.querySelector('altcha-widget'), 'verified', { payload: 'fresh' });
  expect(onVerify).toHaveBeenCalledWith('altcha:fresh');
});

it('does not recreate verification while typing, and uses the latest callback', () => {
  const first = vi.fn(),
    latest = vi.fn(),
    onExpire = vi.fn();
  const view = render(<SignupVerification onVerify={first} onExpire={onExpire} />);
  const widget = document.querySelector('altcha-widget');
  view.rerender(<SignupVerification onVerify={latest} onExpire={onExpire} />);
  expect(document.querySelector('altcha-widget')).toBe(widget);
  expect(widget.configure).not.toHaveBeenCalled();
  event(widget, 'verified', { payload: 'fresh' });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith('altcha:fresh');
});

it('a hung verification cannot leave signup silently waiting forever', () => {
  const onExpire = vi.fn();
  render(<SignupVerification onVerify={vi.fn()} onExpire={onExpire} />);
  act(() => vi.advanceTimersByTime(30000));
  expect(onExpire).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Retry verification' })).toBeInTheDocument();
});
