// Regression test for a real signup-flow bug found during a live click-through
// audit: handleSignUp called setLoading(true) but never set it back to false
// on the success path before switching to the OTP screen. Since the OTP
// screen's Verify button is `disabled={loading || otp.length < 6}`, the
// stuck `loading=true` permanently disabled the button — a brand new user
// could type the correct code and the Verify button would never submit.
// Reproduced live (typed digits, clicked Verify, zero network request fired)
// before the fix, then confirmed the fix by rebuilding and repeating the
// same click-through against a real running server.
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthModal from './AuthModal';
import { AuthProvider } from '../../context/AuthContext';

const verificationMock = vi.hoisted(() => ({ render: vi.fn(), remove: vi.fn() }));
vi.mock('./SignupVerification', async () => {
  const React = await import('react');
  return {
    default: function MockVerification({ onVerify, resetKey }) {
      const container = React.useRef(null);
      React.useEffect(() => {
        const id = verificationMock.render(container.current, { callback: onVerify });
        return () => verificationMock.remove(id);
      }, [resetKey, onVerify]);
      return <div ref={container} data-testid="signup-verification" />;
    },
  };
});

function mockFetchSequence(responses) {
  let call = 0;
  global.fetch = vi.fn(() => {
    const res = responses[Math.min(call, responses.length - 1)];
    call++;
    return Promise.resolve({
      ok: res.ok !== false,
      status: res.status || (res.ok === false ? 400 : 200),
      json: () => Promise.resolve(res.body),
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  verificationMock.render = vi.fn((container, options) => {
    queueMicrotask(() => options.callback('test-challenge-token'));
    return 'test-widget';
  });
  verificationMock.remove = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('the OTP Verify button is enabled (not stuck on the signup loading state) once the code screen appears', async () => {
  const user = userEvent.setup();
  mockFetchSequence([
    { body: {} }, // POST /api/auth/refresh on mount (AuthProvider) — token invalid/none, fine either way
    { body: { ok: true } }, // POST /api/auth/signup
  ]);

  render(
    <AuthProvider>
      <AuthModal onClose={() => {}} />
    </AuthProvider>
  );

  await user.click(screen.getByRole('button', { name: /sign up/i }));
  await user.type(screen.getByPlaceholderText('you@example.com'), 'newuser@test.local');
  await user.type(screen.getByPlaceholderText('Min 8 characters'), 'SomePassword123');
  await user.click(screen.getByRole('button', { name: /create account/i }));

  const verifyBtn = await waitFor(() => screen.getByRole('button', { name: /verify/i }));
  // Not asserting otp.length >= 6 here (no code typed yet) — asserting
  // specifically that it isn't stuck disabled by the signup call's loading
  // flag, which is the actual bug: fill the code and confirm it becomes
  // clickable.
  const digitInputs = document.querySelectorAll('.otp-digit');
  expect(digitInputs.length).toBe(6);
  for (const [i, el] of [...digitInputs].entries()) {
    await user.type(el, String((i + 1) % 10));
  }

  expect(verifyBtn).not.toBeDisabled();
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/auth/refresh',
    expect.objectContaining({ method: 'POST', credentials: 'include' })
  );
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/auth/signup',
    expect.objectContaining({ method: 'POST', credentials: 'include' })
  );
});

it('closes the authentication dialog from its close button', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  mockFetchSequence([{ body: {} }]);

  render(
    <AuthProvider>
      <AuthModal onClose={onClose} />
    </AuthProvider>
  );

  await user.click(screen.getByRole('button', { name: 'Close' }));

  expect(onClose).toHaveBeenCalledOnce();
});

it('does not submit signup until verification succeeds, including on Enter', async () => {
  verificationMock.render = vi.fn(() => 'test-widget');
  mockFetchSequence([{ body: {} }]);
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <AuthModal initialScreen="signup" onClose={() => {}} />
    </AuthProvider>
  );
  await user.type(screen.getByLabelText('Email'), 'newuser@test.local');
  await user.type(screen.getByLabelText('Password'), 'SomePassword123');
  expect(screen.getByRole('button', { name: 'Create Account' })).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/auth/signup')).toHaveLength(0);
  await act(async () => verificationMock.render.mock.calls[0][1].callback('fresh-token'));
  expect(screen.getByRole('button', { name: 'Create Account' })).not.toBeDisabled();
});

it('requires a fresh challenge after a failed signup instead of reusing the consumed token', async () => {
  const user = userEvent.setup();
  mockFetchSequence([
    { body: {} },
    { ok: false, body: { error: 'CAPTCHA verification failed' } },
    { body: { success: true } },
  ]);
  render(
    <AuthProvider>
      <AuthModal initialScreen="signup" onClose={() => {}} />
    </AuthProvider>
  );
  await user.type(screen.getByLabelText('Email'), 'newuser@test.local');
  await user.type(screen.getByLabelText('Password'), 'SomePassword123');
  verificationMock.render.mockImplementation(() => 'replacement-widget');
  await user.click(screen.getByRole('button', { name: 'Create Account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please verify again');
  expect(verificationMock.remove).toHaveBeenCalledWith('test-widget');
  expect(verificationMock.render).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Create Account' })).toBeDisabled();
  await act(async () => verificationMock.render.mock.calls[1][1].callback('new-token'));
  await user.click(screen.getByRole('button', { name: 'Create Account' }));
  expect(await screen.findByRole('button', { name: 'Verify →' })).toBeInTheDocument();
  const signupCalls = global.fetch.mock.calls.filter(([url]) => url === '/api/auth/signup');
  expect(JSON.parse(signupCalls[1][1].body).captchaToken).toBe('new-token');
});

it('continues an unverified password login to the code screen using the structured response', async () => {
  const user = userEvent.setup();
  mockFetchSequence([{ body: {} }, { ok: false, body: { needsVerification: true }, status: 403 }]);
  render(
    <AuthProvider>
      <AuthModal onClose={() => {}} />
    </AuthProvider>
  );
  await user.type(screen.getByLabelText('Email'), 'pending@test.local');
  await user.type(screen.getByLabelText('Password'), 'SomePassword123');
  await user.click(
    screen.getAllByRole('button', { name: 'Log In', exact: true }).find((button) => button.closest('form'))
  );
  expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
});
