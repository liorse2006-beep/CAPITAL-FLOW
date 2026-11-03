import { useLayoutEffect, useRef, useState } from 'react';

const SCAN_ERROR = "We couldn't load scan results. Please try again.";
const TIMEOUT_ERROR = 'Your scan is taking longer than expected. Please try again.';
const IDLE = { running: false, progress: null, liveResults: [], error: null };

async function readScan(path, token, controller) {
  const timeout = setTimeout(() => controller.abort(), 30000);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Scan request interrupted', 'AbortError'));
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const request = fetch(path, {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
      cache: 'no-store',
    }).then(async (response) => ({ status: response.status, ok: response.ok, data: await response.json() }));
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

export default function useResumableScan({ ownerId, getToken, progressPath, resultsPath, onComplete, onStartError }) {
  const scopeRef = useRef(null);
  const handlers = useRef(null);
  const [state, setState] = useState({ ownerId, ...IDLE });
  if (state.ownerId !== ownerId) setState({ ownerId, ...IDLE });

  useLayoutEffect(() => {
    handlers.current = { onComplete, onStartError };
  }, [onComplete, onStartError]);

  useLayoutEffect(() => {
    if (ownerId == null) return;
    const scope = { run: null, request: null, timer: null, needsRestore: true };
    scopeRef.current = scope;
    const current = () => scopeRef.current === scope;
    const update = (next) => {
      if (current())
        setState((previous) => ({ ...(previous.ownerId === ownerId ? previous : IDLE), ...next, ownerId }));
    };
    const settle = (error = null) => {
      clearInterval(scope.timer);
      scope.timer = null;
      scope.run = null;
      update({ ...IDLE, error });
    };
    const apply = (data, restored) => {
      if (!Array.isArray(data?.results) || data.results.some((row) => typeof row?.symbol !== 'string')) return false;
      handlers.current.onComplete(data, restored);
      settle();
      return true;
    };
    const follow = (scanId, data, restored) => {
      scope.run = { scanId, restored, deadline: Date.now() + 10 * 60 * 1000 };
      update({ running: true, progress: data.progress ?? data, liveResults: data.liveResults ?? [], error: null });
      scope.timer ??= setInterval(sync, 1500);
    };
    async function read(path, request) {
      const token = getToken();
      if (!token) return null;
      const result = await readScan(path, token, request);
      return current() && scope.request === request && token === getToken() ? result : null;
    }
    async function sync() {
      if (!current() || document.visibilityState === 'hidden' || (!scope.run && !scope.needsRestore)) return;
      if (scope.request) return;
      const request = new AbortController();
      scope.request = request;
      const run = scope.run;
      try {
        const status = await read(progressPath, request);
        if (!status?.ok || !status.data) return;
        const data = status.data;
        if (data.running) {
          if (!data.scanId || (run && data.scanId !== run.scanId)) return;
          scope.needsRestore = false;
          if (run) update({ progress: data.progress ?? data, liveResults: data.liveResults ?? [] });
          else follow(data.scanId, data, true);
          return;
        }
        const finishedId = data.lastScanId ?? data.scanId;
        if (run && finishedId !== run.scanId) return;
        if (run && data.error) {
          settle(SCAN_ERROR);
          return;
        }
        const suffix = finishedId ? '?scanId=' + encodeURIComponent(finishedId) : '';
        const result = await read(resultsPath + suffix, request);
        if (!result) return;
        if (result.ok && (!finishedId || result.data?.scanId === finishedId)) {
          scope.needsRestore = false;
          if (!apply(result.data, !run || run.restored) && run) settle(SCAN_ERROR);
        } else if (!run && result.status === 409) {
          scope.needsRestore = false;
        }
      } catch {
        // A suspended browser or a refreshed session can interrupt a read.
        // The server job remains active and the next poll can reconnect.
      } finally {
        if (scope.request === request) {
          scope.request = null;
          if (current() && scope.run === run && run && Date.now() >= run.deadline) {
            scope.needsRestore = true;
            settle(TIMEOUT_ERROR);
          }
        }
      }
    }
    scope.start = async (url) => {
      if (!current() || scope.run || scope.starting || !getToken()) return;
      scope.starting = true;
      scope.wokeWhileStarting = false;
      scope.needsRestore = false;
      scope.request?.abort();
      const request = new AbortController();
      scope.request = request;
      update({ ...IDLE, running: true, progress: { processed: 0, total: 1, found: 0, phase: 1 } });
      let recover = false;
      try {
        const reply = await read(url, request);
        if (!current()) return;
        if (!reply || reply.status === 409) {
          recover = true;
          settle();
        } else if (!reply.ok) {
          const handled = handlers.current.onStartError?.(reply);
          settle(handled ? null : SCAN_ERROR);
        } else if (
          reply.status === 202 &&
          reply.data?.queued &&
          typeof reply.data.scanId === 'string' &&
          reply.data.scanId
        ) {
          follow(reply.data.scanId, reply.data, false);
        } else if (reply.status === 202 || !apply(reply.data, false)) {
          settle(SCAN_ERROR);
        }
      } catch (error) {
        if (!current()) return;
        recover = true;
        settle(error.name === 'AbortError' ? TIMEOUT_ERROR : SCAN_ERROR);
      } finally {
        scope.starting = false;
        if (scope.request === request) scope.request = null;
        if (current() && recover) {
          scope.needsRestore = true;
          if (!request.signal.aborted || scope.wokeWhileStarting) void sync();
        }
      }
    };
    function resume() {
      if (document.visibilityState === 'hidden') {
        if (!scope.starting && scope.request) {
          scope.request.abort();
          scope.request = null;
        }
        return;
      }
      if (scope.starting) scope.wokeWhileStarting = true;
      void sync();
    }
    scope.dismissError = () => update({ error: null });
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    queueMicrotask(() => {
      if (!scope.starting) void sync();
    });
    return () => {
      scopeRef.current = null;
      clearInterval(scope.timer);
      scope.request?.abort();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
    };
  }, [ownerId, getToken, progressPath, resultsPath]);

  return {
    ...(state.ownerId === ownerId ? state : IDLE),
    start: (url) => scopeRef.current?.start(url),
    dismissError: () => scopeRef.current?.dismissError(),
  };
}
