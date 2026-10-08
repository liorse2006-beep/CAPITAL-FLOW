import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { identify, reset as resetAnalytics } from '../analytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('auth_error');
  });
  const [authLoadError, setAuthLoadError] = useState(false);
  const [pendingGoogleToken, setPendingGoogleToken] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('google_pending');
  });
  // Access tokens are deliberately memory-only. The refresh token remains in
  // the server-issued httpOnly cookie, while a bearer token copied into
  // localStorage would be readable by any script that ever crossed the site's
  // XSS boundary. A page reload silently obtains a new access token instead.
  const accessTokenRef = useRef(null);
  const legacyAccessTokenRef = useRef(undefined);
  const sessionEpochRef = useRef(0);
  const activeRef = useRef(false);
  const requestsRef = useRef(new Set());

  const invalidatePendingAuth = useCallback(() => {
    sessionEpochRef.current += 1;
    for (const request of requestsRef.current) {
      clearTimeout(request.timeout);
      request.controller.abort();
    }
    requestsRef.current.clear();
    return sessionEpochRef.current;
  }, []);

  useLayoutEffect(() => {
    activeRef.current = true;
    invalidatePendingAuth();
    return () => {
      activeRef.current = false;
      invalidatePendingAuth();
    };
  }, [invalidatePendingAuth]);

  const isCurrentEpoch = useCallback((epoch) => activeRef.current && sessionEpochRef.current === epoch, []);

  const startRequest = useCallback(() => {
    const controller = new AbortController();
    const request = { controller, timeout: setTimeout(() => controller.abort(), 30000) };
    requestsRef.current.add(request);
    return {
      signal: controller.signal,
      finish: () => {
        clearTimeout(request.timeout);
        requestsRef.current.delete(request);
      },
    };
  }, []);

  const setAccessToken = useCallback((token) => {
    accessTokenRef.current = token || null;
  }, []);

  // Exchanges the httpOnly refresh cookie for a fresh access token. The
  // result deliberately distinguishes an actually unauthenticated browser
  // (401/403) from a temporary network/server failure. Treating a 5xx, 429,
  // timeout, or cold-start failure as "logged out" is especially damaging on
  // mobile: the app can be backgrounded while the server sleeps, then reopen
  // with a perfectly valid cookie and incorrectly show the sign-in screen.
  // The returned bearer is never persisted in browser storage.
  const silentRefresh = useCallback(
    async ({ retryTransient = false } = {}) => {
      const maxAttempts = retryTransient ? 3 : 1;
      const epoch = sessionEpochRef.current;
      const startingToken = accessTokenRef.current;
      const isCurrent = () => isCurrentEpoch(epoch) && accessTokenRef.current === startingToken;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!isCurrent()) return { token: null, status: 'superseded' };
        const request = startRequest();
        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
            signal: request.signal,
          });
          if (!isCurrent()) return { token: null, status: 'superseded' };

          if (res.ok) {
            const data = await res.json();
            if (!isCurrent() || request.signal.aborted) return { token: null, status: 'superseded' };
            if (typeof data.token !== 'string' || !data.token) return { token: null, status: 'unavailable' };
            setAccessToken(data.token);
            return { token: data.token, status: 'authenticated' };
          }

          // Only an explicit authorization failure means the cookie/session
          // is no longer valid. Every other response is transient and must
          // not turn a temporary outage into a false logout.
          if (res.status === 401 || res.status === 403) {
            return { token: null, status: 'unauthenticated' };
          }

          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            continue;
          }
          return { token: null, status: 'unavailable' };
        } catch {
          if (!isCurrent()) return { token: null, status: 'superseded' };
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            continue;
          }
          return { token: null, status: 'unavailable' };
        } finally {
          request.finish();
        }
      }

      return { token: null, status: 'unavailable' };
    },
    [setAccessToken, isCurrentEpoch, startRequest]
  );

  const fetchMe = useCallback(
    async (token, isRevalidation, epoch = sessionEpochRef.current) => {
      const isCurrent = () => isCurrentEpoch(epoch) && accessTokenRef.current === token;
      // A sleeping Render free instance can take 30-50s to answer the very
      // first request while it wakes up. The old 8s timeout aborted long
      // before that and then DELETED the token, silently logging the user out
      // on every cold start — which is what made their saved account data
      // "disappear" until they signed in again. So: a generous
      // timeout, and a couple of retries on the initial load. Only a genuine
      // auth failure (a real 401/403 response) ever removes the token now.
      const MAX_ATTEMPTS = isRevalidation ? 1 : 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!isCurrent()) return;
        const request = startRequest();
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
            signal: request.signal,
          });
          if (!isCurrent()) return;
          if (res.ok) {
            const data = await res.json();
            if (!isCurrent() || request.signal.aborted) return;
            if (!Number.isSafeInteger(data.user?.id) || data.user.id <= 0) {
              if (!isRevalidation) setAuthLoadError(true);
              return;
            }
            setAccessToken(token);
            setUser(data.user);
            setAuthLoadError(false);
            return;
          }
          // Only an authorization response means the session is genuinely no
          // longer valid (expired, revoked, or replaced on another device).
          // A 5xx/429/other server response is an infrastructure or routing
          // failure; signing the user out there would turn a temporary outage
          // into data loss/dead-end UX and would leave the refresh cookie
          // needlessly hidden behind a login screen.
          if (res.status === 401 || res.status === 403) {
            setAccessToken(null);
            setUser(null);
            if (isRevalidation) setAuthError('session_replaced');
          } else if (!isRevalidation) {
            setAuthLoadError(true);
          }
          return;
        } catch {
          if (!isCurrent()) return;
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
        } finally {
          request.finish();
        }
      }
    },
    [setAccessToken, isCurrentEpoch, startRequest]
  );

  useEffect(() => {
    const epoch = sessionEpochRef.current;
    const params = new URLSearchParams(window.location.search);
    // google_pending travels as a URL fragment (#...), not a query string —
    // the browser never sends a fragment to any server or Referer header,
    // where a query string carrying the same access token would. See
    // routes/auth.js's /google/callback for the redirect side of this.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const pendingFromUrl = hashParams.get('google_pending');
    const errorFromUrl = params.get('auth_error');
    const inviteFromUrl = params.get('invite');

    if (inviteFromUrl) {
      localStorage.setItem('vs_pilot_invite', inviteFromUrl);
    }

    if (params.has('token')) {
      // A link must not choose an account for the visitor. Current OAuth
      // uses an explicit fragment-based confirmation, never a query bearer.
      params.delete('token');
      const search = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (search ? `?${search}` : '') + window.location.hash
      );
    }

    if (pendingFromUrl) {
      // Don't log in yet — wait for user to confirm on the consent screen
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (errorFromUrl) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Migrate old sessions once, without preserving the bearer token in
    // browser storage. The value is used only for this boot if the refresh
    // cookie is unavailable, then is removed immediately.
    if (legacyAccessTokenRef.current === undefined) {
      legacyAccessTokenRef.current = null;
      try {
        legacyAccessTokenRef.current = localStorage.getItem('vs_token');
        if (legacyAccessTokenRef.current) localStorage.removeItem('vs_token');
      } catch {
        // Restricted browser storage must not prevent cookie authentication.
      }
    }
    // Keep the one-time migration in memory across StrictMode's effect
    // replay; only the still-current startup operation may consume it.
    const stored = legacyAccessTokenRef.current;
    // Try the httpOnly refresh cookie first, even before looking at whatever
    // access token localStorage has — this is what makes a device stay
    // signed in across the 1h access token's expiry (including after the
    // app was closed for hours/days) without ever showing a login screen,
    // and it also recovers a session if the browser cleared localStorage
    // but not cookies (Safari's storage-eviction rules differ between the
    // two, so this is a real, not just theoretical, recovery path).
    silentRefresh({ retryTransient: true })
      .then((refreshResult) => {
        if (!isCurrentEpoch(epoch) || refreshResult.status === 'superseded') return;
        const tokenToUse = refreshResult.token || stored;
        if (tokenToUse) {
          setAccessToken(tokenToUse);
          return fetchMe(tokenToUse, false, epoch);
        }

        // A transient refresh failure means the existing httpOnly cookie may
        // still be valid. Keep the user out of a misleading guest state and
        // let the startup retry affordance recover without asking for a
        // password again.
        setAuthLoadError(refreshResult.status === 'unavailable');
      })
      .finally(() => {
        if (isCurrentEpoch(epoch)) {
          legacyAccessTokenRef.current = null;
          setIsLoading(false);
        }
      });
  }, [fetchMe, setAccessToken, silentRefresh, isCurrentEpoch]);

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
      const token = accessTokenRef.current;
      if (token) fetchMe(token, true);
    }
    // The access token itself only lives 1h — proactively trading it in for
    // a fresh one well before then (and whenever the tab regains focus,
    // since a backgrounded/suspended mobile tab can silently outlive that
    // hour) means the 90s recheck above almost never has to discover an
    // actually-expired token, only a genuinely revoked one.
    async function refreshThenRecheck() {
      const epoch = sessionEpochRef.current;
      const refreshResult = await silentRefresh();
      // If refresh is temporarily unavailable, keep the existing in-memory
      // account and let the next focus/interval retry. Only /me returning a
      // real 401/403 may clear an already-established session.
      if (!isCurrentEpoch(epoch) || refreshResult.status === 'unavailable' || refreshResult.status === 'superseded')
        return;
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
  }, [user, fetchMe, silentRefresh, isCurrentEpoch]);

  function login(token, userData) {
    invalidatePendingAuth();
    legacyAccessTokenRef.current = null;
    setAccessToken(token);
    setUser(userData);
    setAuthLoadError(false);
    setIsLoading(false);
  }

  async function logout() {
    const token = accessTokenRef.current;
    invalidatePendingAuth();
    legacyAccessTokenRef.current = null;
    setAccessToken(null);
    setAuthLoadError(false);
    setUser(null);
    setIsLoading(false);
    // Revoke this device's session server-side (and its refresh cookie) so
    // "log out" actually ends the session. keepalive lets the request finish
    // while the browser navigates away, so logout never waits on a slow API
    // response and never leaves the user on an app route.
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {
        /* offline/unreachable — local logout still proceeds */
      });
    }
    // A logout is always a return to the public landing page, regardless of
    // which in-app route the account was using when it signed out.
    window.location.replace('/');
  }

  const getToken = useCallback(() => accessTokenRef.current, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  function confirmGoogleLogin() {
    if (!pendingGoogleToken) return Promise.resolve();
    const token = pendingGoogleToken;
    const epoch = invalidatePendingAuth();
    setAccessToken(token);
    const invite = localStorage.getItem('vs_pilot_invite');
    const afterLogin = invite
      ? fetch('/api/auth/apply-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          credentials: 'include',
          body: JSON.stringify({ inviteCode: invite }),
        })
          .then(() => localStorage.removeItem('vs_pilot_invite'))
          .catch(() => {})
      : Promise.resolve();
    return afterLogin
      .then(() => {
        if (isCurrentEpoch(epoch)) return fetchMe(token, false, epoch);
      })
      .finally(() => {
        if (isCurrentEpoch(epoch)) setPendingGoogleToken(null);
      });
  }

  function cancelGoogleLogin() {
    invalidatePendingAuth();
    setAccessToken(null);
    setPendingGoogleToken(null);
    setIsLoading(false);
  }

  async function acceptPilotTerms() {
    const token = getToken();
    if (!token) return;
    const epoch = sessionEpochRef.current;
    const request = startRequest();
    try {
      const res = await fetch('/api/auth/accept-pilot-terms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        signal: request.signal,
      });
      if (res.ok && isCurrentEpoch(epoch) && accessTokenRef.current === token && !request.signal.aborted) {
        await fetchMe(token, false, epoch);
      }
    } finally {
      request.finish();
    }
  }

  // Re-pulls /api/auth/me on demand — used after checkout completes, since
  // the tier upgrade lands via a server-side webhook that may finish a
  // moment after Whop redirects the browser back from checkout.
  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (token) await fetchMe(token);
  }, [fetchMe, getToken]);

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
        refreshSession: silentRefresh,
        acceptPilotTerms,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// The context provider and hook intentionally live together; splitting this
// one-line consumer hook would add import churn without changing runtime
// behavior. Fast-refresh validation is not applicable to this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
