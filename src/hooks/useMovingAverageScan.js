import { useState } from 'react';
import useResumableScan from './useResumableScan';

export default function useMovingAverageScan({ user, getToken, setScanMeta, refreshQuota, onTrialEnded, isPremium }) {
  const ownerId = user?.id;
  const [snapshot, setSnapshot] = useState(null);
  const { running, progress, error, dismissError, start } = useResumableScan({
    ownerId,
    getToken,
    progressPath: '/api/ma-progress',
    resultsPath: '/api/ma-last-results',
    onComplete(data) {
      setSnapshot({ ownerId, data });
      setScanMeta({ tier: data.tier, isPremium: data.isPremium, premium: data.premium, free: data.free });
    },
    onStartError({ data }) {
      if (data?.code === 'SCAN_LIMIT') {
        refreshQuota();
        if (!isPremium) onTrialEnded?.();
      }
      return false;
    },
  });

  if (snapshot && snapshot.ownerId !== ownerId) setSnapshot(null);
  const data = snapshot?.ownerId === ownerId ? snapshot?.data : null;

  function startScan(recipe, limitReached) {
    if (!user || running) return;
    if (limitReached) {
      onTrialEnded?.();
      return;
    }
    const params = new URLSearchParams({
      ma: recipe.ma,
      distance: recipe.distance,
      interval: recipe.timeframe,
      market: recipe.market,
      async: '1',
    });
    if (recipe.market === 'sectors' && recipe.selectedSectors.length > 0)
      params.set('sectors', recipe.selectedSectors.join(','));
    void start('/api/scan-ma?' + params);
  }

  return {
    results: data?.results ?? null,
    resultParams: data?.params,
    scanTime: data?.scanTime,
    dataAsOf: data?.dataAsOf,
    dataStatus: data ? data.dataStatus || 'unknown' : null,
    loading: running,
    progress,
    error,
    setError: dismissError,
    startScan,
  };
}
