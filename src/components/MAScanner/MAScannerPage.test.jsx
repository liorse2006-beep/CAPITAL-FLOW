import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MAScannerPage from './MAScannerPage';

const fixture = vi.hoisted(() => ({
  user: { id: 1, is_premium: true },
  token: 'synthetic-owner-one',
  getToken: () => fixture.token,
  setScanMeta: vi.fn(),
  refreshQuota: vi.fn(),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => fixture }));
vi.mock('../../hooks/useScanQuota', () => ({ default: () => ({ ...fixture, scanMeta: null }) }));
vi.mock('../../hooks/useSeo', () => ({ default: () => {} }));
vi.mock('../shared/ScanLoader', () => ({ default: () => <span>Fixture scan loading</span> }));
vi.mock('../shared/ScheduleScan', () => ({ default: () => null }));

const props = {
  onTrialEnded: vi.fn(),
  onSignIn: vi.fn(),
  isInWatchlist: () => false,
  toggleWatchlistTicker: vi.fn(),
  promptCreateAlert: vi.fn(),
};
const row = { symbol: 'FIXA', name: 'Synthetic fixture', price: 100, maValue: 99, maDistance: 1, direction: 'above' };
const jsonResponse = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const never = () => new Promise(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  fixture.user = { id: 1, is_premium: true };
  fixture.token = 'synthetic-owner-one';
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function begin() {
  const view = render(<MAScannerPage {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run MA Scan' }));
  return view;
}

describe('MA scan request lifetime', () => {
  it('ends a hung initial request after thirty seconds and allows a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(never));
    begin();
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(screen.queryByText('Fixture scan loading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run MA Scan' })).toBeEnabled();
    expect(screen.getByText(/scan.*try again/i)).toBeInTheDocument();
  });

  it('also bounds a response whose JSON body never finishes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: never }))
    );
    begin();
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(screen.queryByText('Fixture scan loading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run MA Scan' })).toBeEnabled();
  });

  it('aborts every pending request and clears all scan timers on unmount', async () => {
    const fetch = vi.fn(never);
    vi.stubGlobal('fetch', fetch);
    const view = begin();
    const signal = fetch.mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap progress requests when one is still waiting', async () => {
    const fetch = vi.fn((path) =>
      path.startsWith('/api/scan-ma')
        ? Promise.resolve(jsonResponse({ queued: true, scanId: 'synthetic-job' }, 202))
        : never()
    );
    vi.stubGlobal('fetch', fetch);
    begin();
    await act(() => vi.advanceTimersByTimeAsync(4500));
    expect(fetch.mock.calls.filter(([path]) => path === '/api/ma-progress')).toHaveLength(1);
  });

  it('ignores a late result after its deadline even if the transport ignores abort', async () => {
    let finish;
    const pending = new Promise((resolve) => (finish = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn((path) => (path.startsWith('/api/scan-ma') ? pending : never()))
    );
    begin();
    await act(() => vi.advanceTimersByTimeAsync(30000));
    await act(async () => finish(jsonResponse({ results: [row], dataStatus: 'complete' })));
    expect(screen.queryAllByText('FIXA')).toHaveLength(0);
    expect(fixture.setScanMeta).not.toHaveBeenCalled();
  });

  it('clears the previous owner and cannot apply that owner’s delayed result', async () => {
    let finish;
    const fetch = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    vi.stubGlobal('fetch', fetch);
    const view = begin();
    const oldSignal = fetch.mock.calls[0][1]?.signal;
    fixture.user = { id: 2, is_premium: true };
    fixture.token = 'synthetic-owner-two';
    view.rerender(<MAScannerPage {...props} />);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => finish(jsonResponse({ results: [row], dataStatus: 'complete' })));
    expect(screen.queryAllByText('FIXA')).toHaveLength(0);
    expect(fixture.setScanMeta).not.toHaveBeenCalled();
  });

  it('retains an immediate partial result with one row and clears every timer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ results: [row], dataStatus: 'partial', tier: 'elite' }))
    );
    begin();
    await act(async () => {});
    expect(screen.getAllByText('FIXA')).toHaveLength(2);
    expect(screen.getByText(/data may be delayed or incomplete/i)).toBeInTheDocument();
    expect(fixture.setScanMeta).toHaveBeenCalledWith(expect.objectContaining({ tier: 'elite' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('completes the matching queued job and does not use another scan’s progress', async () => {
    let polls = 0;
    const fetch = vi.fn(async (path) => {
      if (path.startsWith('/api/scan-ma')) return jsonResponse({ queued: true, scanId: 'synthetic-job' }, 202);
      if (path === '/api/ma-progress')
        return jsonResponse({ running: false, scanId: ++polls === 1 ? 'other-job' : 'synthetic-job' });
      return jsonResponse({ scanId: 'synthetic-job', results: [row], dataStatus: 'complete' });
    });
    vi.stubGlobal('fetch', fetch);
    begin();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(fetch.mock.calls.some(([path]) => path.startsWith('/api/ma-last-results'))).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getAllByText('FIXA')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for a not-yet-published result without overlapping, then completes', async () => {
    let resultReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path) => {
        if (path.startsWith('/api/scan-ma')) return jsonResponse({ queued: true, scanId: 'synthetic-job' }, 202);
        if (path === '/api/ma-progress') return jsonResponse({ running: false, scanId: 'synthetic-job' });
        if (++resultReads === 1) return jsonResponse({}, 409);
        return jsonResponse({ scanId: 'synthetic-job', results: [], dataStatus: 'complete' });
      })
    );
    begin();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByText('Fixture scan loading')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.queryByText('Fixture scan loading')).not.toBeInTheDocument();
    expect(resultReads).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a queued job to ten minutes even when progress keeps responding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path) =>
        jsonResponse(
          path.startsWith('/api/scan-ma')
            ? { queued: true, scanId: 'synthetic-job' }
            : { running: true, scanId: 'synthetic-job', processed: 1, total: 3 },
          path.startsWith('/api/scan-ma') ? 202 : 200
        )
      )
    );
    begin();
    await act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000));
    expect(screen.queryByText('Fixture scan loading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run MA Scan' })).toBeEnabled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses safe error copy and refuses malformed result rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ results: [null], dataStatus: 'complete' }))
    );
    begin();
    await act(async () => {});
    expect(screen.getByText('The scan could not return a result. Please try again.')).toBeInTheDocument();
    expect(fixture.setScanMeta).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
