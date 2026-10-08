import { useCallback, useEffect, useState } from 'react';

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 120_000;

// EventSource cannot send a bearer header. Keep its short-lived ticket scoped
// to the active account, renew it before expiry, and recover from HTTP errors
// as well as thrown network errors. The server remains the access authority.
export default function useStreamTicket({ enabled, userId, getToken, refreshSession }) {
  const [current, setCurrent] = useState(null);
  const [generation, setGeneration] = useState(0);
  const renewTicket = useCallback(() => setGeneration((value) => value + 1), []);

  // Expiry is independent of acquisition retries or auth-error restarts.
  // Render reads state only; no wall-clock reads during React rendering.
  useEffect(() => {
    if (!current) return undefined;
    const timer = setTimeout(
      () => {
        setCurrent((value) => (value === current ? null : value));
      },
      Math.max(0, current.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let cancelled = false;
    let inFlight = false;
    let retryTimer;
    let controller;
    let failures = 0;
    let lastAttempt = -Infinity;

    const schedule = (delay) => {
      if (cancelled) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(fetchTicket, delay);
    };
    const retry = (response) => {
      failures += 1;
      let delay = Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** Math.min(failures - 1, 2));
      const retryAfter = response?.headers?.get?.('Retry-After');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(wait)) delay = Math.max(delay, Math.min(300_000, wait));
      }
      schedule(delay);
    };
    const request = async (token) => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch('/api/stream-ticket', {
          headers: { Authorization: 'Bearer ' + (token || '') },
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const data = response.ok ? await response.json() : null;
        return { response, data };
      } finally {
        clearTimeout(timeout);
      }
    };

    async function fetchTicket() {
      if (cancelled || inFlight) return;
      inFlight = true;
      lastAttempt = Date.now();
      clearTimeout(retryTimer);
      try {
        let result = await request(getToken());
        if (cancelled) return;
        // A suspended mobile tab may outlive its bearer token. Exchange the
        // existing httpOnly cookie once; never turn a 403 into a client grant.
        if (result.response.status === 401 && refreshSession) {
          const refreshed = await refreshSession();
          if (cancelled) return;
          if (refreshed?.token) result = await request(refreshed.token);
        }
        if (cancelled) return;
        const { response, data } = result;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) setCurrent(null);
          retry(response);
          return;
        }
        const expiresIn = Number(data?.expiresIn);
        if (typeof data?.ticket !== 'string' || !data.ticket || !Number.isFinite(expiresIn) || expiresIn <= 0) {
          retry();
          return;
        }
        const lifetime = Math.min(expiresIn * 1000, 10 * 60 * 1000);
        failures = 0;
        setCurrent({ userId, ticket: data.ticket, expiresAt: Date.now() + lifetime });
        schedule(Math.max(1000, lifetime - Math.min(120_000, lifetime / 2)));
      } catch {
        if (!cancelled) retry();
      } finally {
        inFlight = false;
      }
    }

    const reconnect = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastAttempt < 5000) return;
      fetchTicket();
    };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    fetchTicket();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      controller?.abort();
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
    };
  }, [enabled, userId, getToken, refreshSession, generation]);

  const ticket = enabled && current?.userId === userId ? current.ticket : null;
  return { ticket, renewTicket };
}
