import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export default function useScheduledScans(scanType) {
  const { getToken, user } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mySchedules = schedules.filter((s) => s.scan_type === scanType);

  const fetchSchedules = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/scheduled-scans', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch (_) {}
  }, [getToken]);

  useEffect(() => {
    if (user) fetchSchedules();
  }, [user, fetchSchedules]);

  async function addSchedule(scan_time) {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch('/api/scheduled-scans', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_type: scanType, scan_time }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create schedule');
      setSchedules((prev) => [data, ...prev]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSchedule(id, active) {
    try {
      const token = getToken();
      const res = await fetch(`/api/scheduled-scans/${id}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSchedule(id) {
    try {
      const token = getToken();
      const res = await fetch(`/api/scheduled-scans/${id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return;
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (_) {}
  }

  return { mySchedules, loading, error, addSchedule, toggleSchedule, removeSchedule, refresh: fetchSchedules };
}
