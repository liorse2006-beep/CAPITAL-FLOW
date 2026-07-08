import { useEffect, useRef, useCallback } from 'react';

const BASE_DELAY = 1000;
const MAX_DELAY  = 30000;

/**
 * Auto-reconnecting EventSource hook.
 *
 * @param {string}   url        - SSE endpoint
 * @param {Object}   handlers   - Map of event-name → callback(data)
 * @param {boolean}  enabled    - Pause/resume without unmounting
 */
export default function useSSE(url, handlers, enabled = true) {
  const esRef      = useRef(null);
  const timerRef   = useRef(null);
  const delayRef   = useRef(BASE_DELAY);
  const handlersRef = useRef(handlers);

  // Keep handler refs current without re-connecting
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => { delayRef.current = BASE_DELAY; };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      const delay = delayRef.current;
      delayRef.current = Math.min(delay * 2, MAX_DELAY);
      timerRef.current = setTimeout(connect, delay);
    };

    // Register each named event listener
    const names = Object.keys(handlersRef.current || {});
    names.forEach((name) => {
      es.addEventListener(name, (e) => {
        const cb = handlersRef.current[name];
        if (!cb) return;
        try {
          cb(name === 'ping' ? {} : JSON.parse(e.data));
        } catch(_) {}
      });
    });
  }, [url]);

  useEffect(() => {
    if (!enabled || !url) {
      clearTimeout(timerRef.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      return;
    }
    connect();
    return () => {
      clearTimeout(timerRef.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [url, enabled, connect]);
}
