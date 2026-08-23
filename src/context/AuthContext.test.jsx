// Regression coverage for a production-audit finding: the Google OAuth
// callback used to hand the access token back via a query string
// (?google_pending=<token>), which the browser sends to the server on that
// very request and to any third-party resource the page loads before the
// token is read, via the Referer header. A URL fragment (#google_pending=)
// never leaves the browser either way. See routes/auth.js for the redirect
// side of this fix.
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

function Probe() {
  const { pendingGoogleToken } = useAuth();
  return <div data-testid="probe">{pendingGoogleToken || 'none'}</div>;
}

function TokenProbe() {
  const { login, getToken } = useAuth();
  return (
    <button onClick={() => login('memory-token', { id: 1, email: 'admin@example.com' })}>
      {getToken() || 'empty'}
    </button>
  );
}

function setUrl(pathname, hash) {
  window.history.replaceState({}, '', pathname + hash);
}

describe('AuthContext — Google OAuth pending-token handoff', () => {
  it('reads google_pending from the URL fragment, not the query string', async () => {
    setUrl('/', '#google_pending=fake-access-token-123');
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(await screen.findByTestId('probe')).toHaveTextContent('fake-access-token-123');
  });

  it('strips the fragment from the URL after reading it, so a bookmark/share of this page never carries the token', async () => {
    setUrl('/', '#google_pending=fake-access-token-456');
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await screen.findByTestId('probe');
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('');
  });

  it('a google_pending value placed in the query string instead is ignored (the token must only ever arrive via the fragment)', async () => {
    setUrl('/', '');
    window.history.replaceState({}, '', '/?google_pending=should-not-be-read');
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(await screen.findByTestId('probe')).toHaveTextContent('none');
  });

  it('keeps access tokens in memory instead of persisting them in localStorage', () => {
    render(
      <AuthProvider>
        <TokenProbe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('memory-token');
    expect(localStorage.getItem('vs_token')).toBeNull();
  });
});
