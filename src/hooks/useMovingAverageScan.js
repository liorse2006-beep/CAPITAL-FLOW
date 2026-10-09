import { useLayoutEffect, useRef, useState } from 'react';
import useAccountOperation from './useAccountOperation';

const SCAN_ERROR = 'The scan could not return a result. Please try again.';
const TIMEOUT_ERROR = 'The scan took too long to return a result. Please try again.';

function stopRun(run) {
  if (!run) return;
  run.settled = true;
  clearInterval(run.poll);
  clearTimeout(run.deadline);
  for (const operation of run.requests) operation.cancel();
  run.requests.clear();
}

// Server jobs continue independently; this hook bounds only the browser's wait.
export default function useMovingAverageScan({ user, getToken, setScanMeta, refreshQuota, onTrialEnded, isPremium }) {
  const ownerKey = `${user?.id ?? 'guest'}:${getToken?.() || ''}`;
  const startOperation = useAccountOperation(getToken, ownerKey);
  const runRef = useRef(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [stateOwner, setStateOwner] = useState(ownerKey);

  // Reset this component's display during an owner change, before painting.
  // Resource cancellation stays in the layout-effect cleanup below.
  if (stateOwner !== ownerKey) {
    setStateOwner(ownerKey);
    setResults(null);
    setLoading(false);
    setProgress(null);
    setError(null);
    setDataStatus(null);
  }

  useLayoutEffect(() => {
    stopRun(runRef.current);
    runRef.current = null;
    return () => {
      stopRun(runRef.current);
      runRef.current = null;
    };
  }, [ownerKey, getToken]);

  function startScan(recipe, limitReached) {
    if (runRef.current && !runRef.current.settled) return;
    if (!user || !getToken?.()) return;
    if (limitReached) {
      onTrialEnded?.();
      return;
    }
    const run = { token: getToken(), requests: new Set(), settled: false, scanId: null, resolvingResult: false };
    runRef.current = run;
    const active = () => runRef.current === run && !run.settled && getToken() === run.token;
    const fail = (message = SCAN_ERROR) => {
      if (!active()) return;
      stopRun(run);
      setLoading(false);
      setProgress(null);
      setError(message);
    };
    setLoading(true);
    setResults(null);
    setDataStatus(null);
    setError(null);
    setProgress({ processed: 0, total: 0, found: 0, phase: 1 });
    run.deadline = setTimeout(() => fail(TIMEOUT_ERROR), 10 * 60 * 1000);

    async function readJson(path, key, allowPending = false) {
      if (!active()) return null;
      const operation = startOperation(key);
      if (!operation) return null; // One progress/result request at a time, including JSON parsing.
      run.requests.add(operation);
      const onAbort = () => {
        if (operation.isCurrent()) fail(TIMEOUT_ERROR);
      };
      operation.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(path, {
          headers: { Authorization: 'Bearer ' + operation.token },
          signal: operation.signal,
        });
        if (!active() || !operation.canCommit()) return null;
        if (allowPending && response.status === 409) return null;
        const data = await response.json();
        if (!active() || !operation.canCommit()) return null;
        if (!response.ok) throw Object.assign(new Error(SCAN_ERROR), { code: data?.code });
        return { data, status: response.status };
      } finally {
        operation.signal.removeEventListener('abort', onAbort);
        operation.finish();
        run.requests.delete(operation);
      }
    }

    function complete(data) {
      if (!active()) return;
      if (!Array.isArray(data?.results) || data.results.some((row) => !row || typeof row.symbol !== 'string'))
        throw new Error(SCAN_ERROR);
      setResults(data.results);
      setDataStatus(
        ['complete', 'partial', 'unavailable', 'stale'].includes(data.dataStatus) ? data.dataStatus : 'unknown'
      );
      setScanMeta({ tier: data.tier, isPremium: data.isPremium, premium: data.premium, free: data.free });
      stopRun(run);
      setLoading(false);
      setProgress(null);
    }

    async function loadResult() {
      if (!active() || !run.scanId || run.resolvingResult) return;
      run.resolvingResult = true;
      try {
        const reply = await readJson(
          `/api/ma-last-results?scanId=${encodeURIComponent(run.scanId)}`,
          'ma-result',
          true
        );
        if (reply && active() && reply.data?.scanId === run.scanId) complete(reply.data);
      } catch {
        fail();
      } finally {
        run.resolvingResult = false;
      }
    }

    run.poll = setInterval(async () => {
      if (!active() || !run.scanId) return;
      try {
        const reply = await readJson('/api/ma-progress', 'ma-progress');
        if (!reply || !active() || reply.data?.scanId !== run.scanId) return;
        if (reply.data.running) setProgress(reply.data);
        else if (reply.data.error) fail();
        else await loadResult();
      } catch {
        fail();
      }
    }, 1500);

    const params = new URLSearchParams({
      ma: recipe.ma,
      distance: recipe.distance,
      interval: recipe.timeframe,
      market: recipe.market,
    });
    if (recipe.market === 'sectors' && recipe.selectedSectors.length > 0)
      params.set('sectors', recipe.selectedSectors.join(','));
    readJson(`/api/scan-ma?${params}&async=1`, 'ma-start')
      .then((reply) => {
        if (!reply || !active()) return;
        if (reply.status === 202) {
          if (!reply.data?.queued || typeof reply.data.scanId !== 'string' || !reply.data.scanId)
            throw new Error(SCAN_ERROR);
          run.scanId = reply.data.scanId;
          if (reply.data.progress) setProgress(reply.data.progress);
        } else complete(reply.data);
      })
      .catch((reason) => {
        if (!active()) return;
        if (reason.code === 'SCAN_LIMIT') {
          refreshQuota();
          if (!isPremium) onTrialEnded?.();
        }
        fail();
      });
  }

  return { results, loading, progress, error, setError, dataStatus, startScan };
}
