// Regression test for a real signup-flow bug found during a live click-through
// audit: handleSignUp called setLoading(true) but never set it back to false
// on the success path before switching to the OTP screen. Since the OTP
// screen's Verify button is `disabled={loading || otp.length < 6}`, the
// stuck `loading=true` permanently disabled the button — a brand new user
// could type the correct code and the Verify button would never submit.
// Reproduced live (typed digits, clicked Verify, zero network request fired)
// before the fix, then confirmed the fix by rebuilding and repeating the
// same click-through against a real running server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthModal from './AuthModal';
import { AuthProvider } from '../../context/AuthContext';

function mockFetchSequence(responses) {
  let call = 0;
  global.fetch = vi.fn(() => {
    const res = responses[Math.min(call, responses.length - 1)];
    call++;
    return Promise.resolve({
      ok: res.ok !== false,
      json: () => Promise.resolve(res.body),
    });
  });
}

beforeEach(() => {
  localStorage.clear();
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
});
