import React, { createContext, useContext, useState, useEffect } from 'react';
import { identify, reset as resetAnalytics } from '../analytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [pendingGoogleToken, setPendingGoogleToken] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    const pendingFromUrl = params.get('google_pending');
    const errorFromUrl = params.get('auth_error');

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('vs_token');
        setUser(null);
        if (isRevalidation) setAuthError('session_replaced');
      }
    } catch {
      // A network hiccup during a background revalidation shouldn't log the
      // user out — only drop the session on the initial load's own failure.
      if (!isRevalidation) {
        localStorage.removeItem('vs_token');
        setUser(null);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  function login(token, userData) {
    localStorage.setItem('vs_token', token);
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem('vs_token');
    setUser(null);
  }

  function getToken() {
    return localStorage.getItem('vs_token');
  }

  function clearAuthError() {
    setAuthError(null);
  }

  function confirmGoogleLogin() {
    if (!pendingGoogleToken) return;
    localStorage.setItem('vs_token', pendingGoogleToken);
    fetchMe(pendingGoogleToken).finally(() => setPendingGoogleToken(null));
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
  // moment after Paddle's client-side "payment succeeded" callback fires.
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
