import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useScheduledScans from './useScheduledScans';

const getToken = vi.fn(() => 'token');
const user = { id: 7 };

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ getToken, user }),
}));

function response(body, ok = true) {
  return { ok, json: vi.fn().mockResolvedValue(body) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useScheduledScans', () => {
  it('surfaces an initial load failure instead of leaving the panel silently empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: 'Schedules are temporarily unavailable' }, false))
    );

    const { result } = renderHook(() => useScheduledScans('capitalFlow'));

    await waitFor(() => expect(result.current.error).toBe('Schedules are temporarily unavailable'));
    expect(result.current.mySchedules).toEqual([]);
  });

  it('surfaces a failed delete and keeps the schedule visible for retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ schedules: [{ id: 4, scan_type: 'capitalFlow', active: 1 }] }))
      .mockResolvedValueOnce(response({ error: 'Schedule is locked' }, false));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useScheduledScans('capitalFlow'));
    await waitFor(() => expect(result.current.mySchedules).toHaveLength(1));

    await act(async () => {
      await result.current.removeSchedule(4);
    });

    expect(result.current.error).toBe('Schedule is locked');
    expect(result.current.mySchedules).toHaveLength(1);
  });
});
