import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export default function useScheduledScans(scanType) {
  const { getToken, user } = useAuth() || {};
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mySchedules = schedules.filter((s) => s.scan_type === scanType);

  const fetchSchedules = useCallback(async () => {
    const token = typeof getToken === 'function' ? getToken() : null;
    if (!token) {
      setSchedules([]);
      return;
    }
    try {
      const res = await fetch('/api/scheduled-scans', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load scheduled scans');
      setSchedules(data.schedules || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scheduled scans');
    }
  }, [getToken]);

  useEffect(() => {
    if (user) fetchSchedules();
  }, [user, fetchSchedules]);

  async function addSchedule(scan_time, scan_date) {
    setLoading(true);
    setError(null);
    try {
      const token = typeof getToken === 'function' ? getToken() : null;
      if (!token) throw new Error('Please sign in to schedule a scan');
      const res = await fetch('/api/scheduled-scans', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_type: scanType, scan_time, scan_date: scan_date || null }),
      });
      const data = await res.json().catch(() => ({}));
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
      const token = typeof getToken === 'function' ? getToken() : null;
      if (!token) throw new Error('Please sign in to update this schedule');
      const res = await fetch(`/api/scheduled-scans/${id}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update schedule');
      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSchedule(id) {
    try {
      const token = typeof getToken === 'function' ? getToken() : null;
      if (!token) throw new Error('Please sign in to remove this schedule');
      const res = await fetch(`/api/scheduled-scans/${id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove schedule');
      }
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove schedule');
    }
  }

  return { mySchedules, loading, error, addSchedule, toggleSchedule, removeSchedule, refresh: fetchSchedules };
}
