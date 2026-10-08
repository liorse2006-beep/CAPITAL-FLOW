import { useCallback, useLayoutEffect, useRef } from 'react';

// An async account action may finish after the user closes its screen or
// signs in elsewhere. Abort the request and check ownership before any
// global callback, file download, reload, or state update is committed.
export default function useAccountOperation(getToken, ownerKey) {
  const scopeRef = useRef(null);

  useLayoutEffect(() => {
    const scope = { requests: new Map() };
    scopeRef.current = scope;
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
      for (const request of scope.requests.values()) {
        clearTimeout(request.timeout);
        request.controller.abort();
      }
      scope.requests.clear();
    };
  }, [getToken, ownerKey]);

  return useCallback(
    (key) => {
      const scope = scopeRef.current;
      if (!scope || scope.requests.has(key)) return null;
      const token = getToken?.() || '';
      const controller = new AbortController();
      const request = { controller, timeout: setTimeout(() => controller.abort(), 30000) };
      scope.requests.set(key, request);
      const isCurrent = () => scopeRef.current === scope && (getToken?.() || '') === token;
      const finish = () => {
        clearTimeout(request.timeout);
        if (scope.requests.get(key) === request) scope.requests.delete(key);
      };
      return {
        token,
        signal: controller.signal,
        isCurrent,
        canCommit: () => isCurrent() && !controller.signal.aborted,
        finish,
        cancel: () => {
          controller.abort();
          finish();
        },
      };
    },
    [getToken]
  );
}
