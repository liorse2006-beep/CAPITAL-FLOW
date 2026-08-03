import React, { createContext, useContext, useState, useEffect } from 'react';
import { identify, reset as resetAnalytics } from '../analytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authLoadError, setAuthLoadError] = useState(false);
  const [pendingGoogleToken, setPendingGoogleToken] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    const pendingFromUrl = params.get('google_pending');
    const errorFromUrl = params.get('auth_error');
    const inviteFromUrl = params.get('invite');

    if (inviteFromUrl) {
      localStorage.setItem('vs_pilot_invite', inviteFromUrl);
    }

    if (tokenFromUrl) {
      localStorage.setItem('vs_token', tokenFromUrl);
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (pendingFromUrl) {
      // Don't log in yet — wait for user to confirm on the consent screen
      window.history.replaceState({}, '', window.location.pathname);
      setPendingGoogleToken(pendingFromUrl);
    }

    if (errorFromUrl) {
      setAuthError(errorFromUrl);
      window.history.replaceState({}, '', window.location.pathname);
    }

    const stored = localStorage.getItem('vs_token');
    if (stored) {
      fetchMe(stored).finally(() => setIsLoading(false));
    } else {
      setAuthLoadError(false);
      setIsLoading(false);
    }
  }, []);

  // Tie analytics identity to whichever account is currently logged in —
  // fires on initial load, login, and logout alike since it just watches
  // `user`, rather than needing a call at every place user changes.
  useEffect(() => {
    if (user) identify(String(user.id), { email: user.email, tier: user.tier || 'free' });
    else resetAnalytics();
  }, [user]);

  // Every login now invalidates any session already active elsewhere (one
  // device at a time, site-wide). A tab left open on the now-stale device
  // won't get a 401 until it happens to call the API — periodically
  // re-checking /api/auth/me (and on tab focus) surfaces that promptly,
  // instead of the user only finding out the next time they click something.
  useEffect(() => {
    if (!user) return;
    function recheck() {
      const token = localStorage.getItem('vs_token');
      if (token) fetchMe(token, true);
    }
    const interval = setInterval(recheck, 90000);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [user]);

  async function fetchMe(token, isRevalidation) {
    // A sleeping Render free instance can take 30-50s to answer the very
    // first request while it wakes up. The old 8s timeout aborted long
    // before that and then DELETED the token, silently logging the user out
    // on every cold start — which is what made their watchlist and Capi
    // history "disappear" until they signed in again. So: a generous
    // timeout, and a couple of retries on the initial load. Only a genuine
    // auth failure (a real 401/403 response) ever removes the token now.
    const MAX_ATTEMPTS = isRevalidation ? 1 : 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setAuthLoadError(false);
          return;
        }
        // A real auth failure — the token is genuinely no longer valid
        // (expired, or this account signed in on another device). This is
        // the ONLY path that signs the user out.
        localStorage.removeItem('vs_token');
        setUser(null);
        if (isRevalidation) setAuthError('session_replaced');
        return;
      } catch {
        clearTimeout(timeout);
        // Network error or timeout — NOT an auth failure. Keep the token.
        // Retry the initial load a few times (the first request is what
        // wakes the server); a background revalidation just leaves the
        // existing session in place and tries again on its next tick.
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        // Retries exhausted — keep the token so the next open (or a manual
        // reload once the server is up) recovers cleanly. Don't wipe it.
        setAuthLoadError(true);
        return;
      }
    }
  }

  function login(token, userData) {
    localStorage.setItem('vs_token', token);
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem('vs_token');
    // vs_quiz_done is intentionally left alone here — it should show exactly
    // once per device, ever, not once per login session. Clearing it on
    // logout made it reappear for the same person every time they signed
    // out and back in (common during testing), which is the bug this
    // comment used to defend.
    setUser(null);
    window.location.reload();
  }

  function getToken() {
    return localStorage.getItem('vs_token');
  }

  function clearAuthError() {
    setAuthError(null);
  }

  function confirmGoogleLogin() {
    if (!pendingGoogleToken) return Promise.resolve();
    const token = pendingGoogleToken;
    localStorage.setItem('vs_token', token);
    const invite = localStorage.getItem('vs_pilot_invite');
    const afterLogin = invite
      ? fetch('/api/auth/apply-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ inviteCode: invite }),
        })
          .then(() => localStorage.removeItem('vs_pilot_invite'))
          .catch(() => {})
      : Promise.resolve();
    return afterLogin.then(() => fetchMe(token)).finally(() => setPendingGoogleToken(null));
  }

  function cancelGoogleLogin() {
    setPendingGoogleToken(null);
  }

  async function acceptPilotTerms() {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/auth/accept-pilot-terms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) await fetchMe(token);
  }

  // Re-pulls /api/auth/me on demand — used after checkout completes, since
  // the tier upgrade lands via a server-side webhook that may finish a
  // moment after Whop redirects the browser back from checkout.
  async function refreshUser() {
    const token = getToken();
    if (token) await fetchMe(token);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        authError,
        authLoadError,
        clearAuthError,
        pendingGoogleToken,
        confirmGoogleLogin,
        cancelGoogleLogin,
        login,
        logout,
        getToken,
        acceptPilotTerms,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
