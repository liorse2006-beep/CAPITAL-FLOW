import React, { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState(null)
  const [pendingGoogleToken, setPendingGoogleToken] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenFromUrl   = params.get('token')
    const pendingFromUrl = params.get('google_pending')
    const errorFromUrl   = params.get('auth_error')

    if (tokenFromUrl) {
      localStorage.setItem('vs_token', tokenFromUrl)
      window.history.replaceState({}, '', window.location.pathname)
    }

    if (pendingFromUrl) {
      // Don't log in yet — wait for user to confirm on the consent screen
      window.history.replaceState({}, '', window.location.pathname)
      setPendingGoogleToken(pendingFromUrl)
    }

    if (errorFromUrl) {
      setAuthError(errorFromUrl)
      window.history.replaceState({}, '', window.location.pathname)
    }

    const stored = localStorage.getItem('vs_token')
    if (stored) {
      fetchMe(stored).finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  // Every login now invalidates any session already active elsewhere (one
  // device at a time, site-wide). A tab left open on the now-stale device
  // won't get a 401 until it happens to call the API — periodically
  // re-checking /api/auth/me (and on tab focus) surfaces that promptly,
  // instead of the user only finding out the next time they click something.
  useEffect(() => {
    if (!user) return
    function recheck() {
      const token = localStorage.getItem('vs_token')
      if (token) fetchMe(token, true)
    }
    const interval = setInterval(recheck, 90000)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [user])

  async function fetchMe(token, isRevalidation) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        localStorage.removeItem('vs_token')
        setUser(null)
        if (isRevalidation) setAuthError('session_replaced')
      }
    } catch {
      // A network hiccup during a background revalidation shouldn't log the
      // user out — only drop the session on the initial load's own failure.
      if (!isRevalidation) {
        localStorage.removeItem('vs_token')
        setUser(null)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  function login(token, userData) {
    localStorage.setItem('vs_token', token)
    setUser(userData)
  }

  function logout() {
    localStorage.removeItem('vs_token')
    setUser(null)
  }

  function getToken() {
    return localStorage.getItem('vs_token')
  }

  function clearAuthError() { setAuthError(null) }

  function confirmGoogleLogin() {
    if (!pendingGoogleToken) return
    localStorage.setItem('vs_token', pendingGoogleToken)
    fetchMe(pendingGoogleToken).finally(() => setPendingGoogleToken(null))
  }

  function cancelGoogleLogin() {
    setPendingGoogleToken(null)
  }

  async function acceptPilotTerms() {
    const token = getToken()
    if (!token) return
    const res = await fetch('/api/auth/accept-pilot-terms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) await fetchMe(token)
  }

  return (
    <AuthContext.Provider value={{
      user, isLoading, authError, clearAuthError,
      pendingGoogleToken, confirmGoogleLogin, cancelGoogleLogin,
      login, logout, getToken, acceptPilotTerms,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
