import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Retain a push destination until cookie/session restoration or manual login
// finishes. Never display a response belonging to an abandoned user/session.
export default function useNotificationDeepLink({
  userId,
  isLoading,
  authLoadError,
  getToken,
  refreshSession,
  onNotification,
  onUnavailable,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rawId = params.get('notif');
    if (!rawId || isLoading || authLoadError || !userId) return undefined;
    const clearDestination = () => {
      params.delete('notif');
      const query = params.toString();
      navigate(
        { pathname: location.pathname, search: query ? '?' + query : '', hash: location.hash },
        { replace: true }
      );
    };
    if (!/^(?:srv-)?[1-9]\d{0,14}$/.test(rawId)) {
      clearDestination();
      return undefined;
    }
    const id = rawId.replace(/^srv-/, '');
    const controller = new AbortController();
    let timer;
    let stopped = false;
    let attempts = 0;
    async function load() {
      attempts += 1;
      try {
        let token = getToken();
        const request = () =>
          fetch('/api/notifications/' + id, {
            credentials: 'same-origin',
            headers: { Authorization: 'Bearer ' + token },
            signal: controller.signal,
          });
        let response = await request();
        if (response.status === 401 && refreshSession) {
          const session = await refreshSession();
          if (stopped) return;
          if (!session?.token) throw new Error('Session temporarily unavailable');
          token = session.token;
          response = await request();
        }
        if (stopped) return;
        if (response.status === 404 || response.status === 403) {
          onUnavailable?.();
          clearDestination();
          return;
        }
        if (!response.ok) throw new Error('Notification temporarily unavailable');
        const data = await response.json();
        if (stopped) return;
        if (data?.scanType) onNotification(data);
        else onUnavailable?.();
        clearDestination();
      } catch {
        if (!stopped && attempts < 3) timer = window.setTimeout(load, 30000);
      }
    }
    load();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    location.pathname,
    location.search,
    location.hash,
    navigate,
    userId,
    isLoading,
    authLoadError,
    getToken,
    refreshSession,
    onNotification,
    onUnavailable,
  ]);
}
