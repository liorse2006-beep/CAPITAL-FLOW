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
    // google_pending travels as a URL fragment (#...), not a query string —
    // the browser never sends a fragment to any server or Referer header,
    // where a query string carrying the same access token would. See
    // routes/auth.js's /google/callback for the redirect side of this.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const tokenFromUrl = params.get('token');
    const pendingFromUrl = hashParams.get('google_pending');
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
    // Try the httpOnly refresh cookie first, even before looking at whatever
    // access token localStorage has — this is what makes a device stay
    // signed in across the 1h access token's expiry (including after the
    // app was closed for hours/days) without ever showing a login screen,
    // and it also recovers a session if the browser cleared localStorage
    // but not cookies (Safari's storage-eviction rules differ between the
    // two, so this is a real, not just theoretical, recovery path).
    silentRefresh()
      .then((refreshed) => {
        const tokenToUse = refreshed || stored;
        if (tokenToUse) return fetchMe(tokenToUse);
        setAuthLoadError(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Tie analytics identity to whichever account is currently logged in —
  // fires on initial load, login, and logout alike since it just watches
  // `user`, rather than needing a call at every place user changes.
  useEffect(() => {
    if (user) identify(String(user.id), { email: user.email, tier: user.tier || 'free' });
    else resetAnalytics();
  }, [user]);

  // A device is capped at 2 concurrent sessions per account (see
  // server/services/auth.js) — logging in on a 3rd device evicts whichever
  // of the other two was used least recently. A tab left open on an evicted
  // device won't get a 401 until it happens to call the API — periodically
  // re-checking /api/auth/me (and on tab focus) surfaces that promptly,
  // instead of the user only finding out the next time they click something.
  useEffect(() => {
    if (!user) return;
    function recheck() {
      const token = localStorage.getItem('vs_token');
      if (token) fetchMe(token, true);
    }
    // The access token itself only lives 1h — proactively trading it in for
    // a fresh one well before then (and whenever the tab regains focus,
    // since a backgrounded/suspended mobile tab can silently outlive that
    // hour) means the 90s recheck above almost never has to discover an
    // actually-expired token, only a genuinely revoked one.
    async function refreshThenRecheck() {
      await silentRefresh();
      recheck();
    }
    const interval = setInterval(recheck, 90000);
    const refreshInterval = setInterval(refreshThenRecheck, 45 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshThenRecheck);
    return () => {
      clearInterval(interval);
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', refreshThenRecheck);
    };
  }, [user]);

  // Exchanges the httpOnly refresh cookie for a fresh access token. Returns
  // the new token on success, or null (no active session, or the cookie is
  // missing/blocked) — callers fall back to whatever's already in
  // localStorage in that case, same as before this existed.
  async function silentRefresh() {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.token) return null;
      localStorage.setItem('vs_token', data.token);
      return data.token;
    } catch {
      return null;
    }
  }

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

  async function logout() {
    const token = localStorage.getItem('vs_token');
    localStorage.removeItem('vs_token');
    // vs_quiz_done is intentionally left alone here — it should show exactly
    // once per device, ever, not once per login session. Clearing it on
    // logout made it reappear for the same person every time they signed
    // out and back in (common during testing), which is the bug this
    // comment used to defend.
    setUser(null);
    // Revoke this device's session server-side (and its refresh cookie) so
    // "log out" actually ends the session instead of just discarding the
    // local copy of a still-valid access token — best-effort: a failed
    // request here just means the session naturally expires within 1h
    // instead of immediately, not that logout silently fails.
    if (token) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {
        /* offline/unreachable — local logout still proceeds */
      }
    }
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
