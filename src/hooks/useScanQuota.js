import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

// Quota shape depends on tier: free users get one lifetime trial per
// category (`free: { capitalFlow, maScanner, sectorMoving }`), premium users
// share a 5-scan/24h pool (`premium: { used, left, limit, resetsAt }`),
// elite users get both as null (unlimited). See server/services/scanQuota.js
// `quotaFor()` for the authoritative shape — every scan page reads the same
// object via this hook so quota display always means the same thing.
export default function useScanQuota() {
  const { getToken, user } = useAuth();
  const [scanMeta, setScanMeta] = useState(null);

  const refreshQuota = useCallback(() => {
    if (!user) {
      setScanMeta(null);
      return;
    }
    fetch('/api/scan-quota', { headers: { Authorization: 'Bearer ' + getToken() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setScanMeta(d);
      })
      .catch(() => {});
  }, [user, getToken]);

  return { scanMeta, setScanMeta, refreshQuota };
}
