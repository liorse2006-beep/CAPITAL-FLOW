import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ChartModal from './ChartModal';

const { getToken } = vi.hoisted(() => ({ getToken: () => 'isolated-test-token' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ getToken }) }));

function payload(change = {}) {
  return {
    symbol: 'TEST',
    currency: 'USD',
    dataStatus: 'complete',
    quoteDataStatus: 'complete',
    quotes: [
      { date: new Date(Date.now() - 86400000).toISOString(), open: 100, high: 102, low: 99, close: 101, volume: 1000 },
    ],
    ma20: [null],
    ma50: [null],
    currentPrice: { price: 101, change: 1, dataStatus: 'complete', dataAsOf: new Date().toISOString() },
    ...change,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const context = Object.fromEntries(
    [
      'scale',
      'fillRect',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'fillText',
      'setLineDash',
      'closePath',
      'fill',
      'arc',
      'clearRect',
    ].map((name) => [name, vi.fn()])
  );
  context.createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openChart(data) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => data }))
  );
  render(<ChartModal symbol="TEST" name="Test company" onClose={vi.fn()} />);
}

describe('chart customer-facing data quality', () => {
  it('provides an accessible close control with a long company name', async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => payload() }))
    );
    render(
      <ChartModal
        symbol="TEST"
        name="A very long company name that must not push the close button outside the viewport"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close chart', exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('keeps a verified current price and displays its provider observation time', async () => {
    await openChart(payload());
    expect(await screen.findByText(/price as of/i)).toBeInTheDocument();
    expect(screen.getByText('$101.00')).toBeInTheDocument();
  });
  it('labels partial chart data in a short accessible notice', async () => {
    await openChart(payload({ dataStatus: 'partial' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Some chart data is unavailable.');
  });
  it('keeps valid partial quote enrichment but does not call it complete', async () => {
    await openChart(payload({ quoteDataStatus: 'partial' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Some chart data is unavailable.');
    expect(screen.getByText('$101.00')).toBeInTheDocument();
  });
  it('shows historical prices without substituting a historical close for a current quote', async () => {
    await openChart(payload({ currentPrice: null, quoteDataStatus: 'unavailable' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Current price unavailable. Showing historical prices.'
    );
    expect(screen.queryByText('$101.00')).not.toBeInTheDocument();
  });
  it('does not display a current price without an observation timestamp', async () => {
    await openChart(payload({ currentPrice: { price: 101, change: 1, dataAsOf: null } }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Current price unavailable. Showing historical prices.'
    );
    expect(screen.queryByText('$101.00')).not.toBeInTheDocument();
  });
  it('clears the previous price and chart when a new period fails without exposing raw errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => payload() })
        .mockRejectedValueOnce(new Error('connect ECONNRESET internal database'))
    );
    render(<ChartModal symbol="TEST" name="Test company" onClose={vi.fn()} />);
    expect(await screen.findByText('$101.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1W' }));
    expect(
      await screen.findByText('Chart data is not available right now. Try again in a few minutes.')
    ).toBeInTheDocument();
    expect(screen.queryByText('$101.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('.chart-canvas')).toHaveStyle({ visibility: 'hidden' });
    expect(screen.queryByText(/ECONNRESET|internal database/)).not.toBeInTheDocument();
  });
  it('does not render technical server error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'API returned 500: provider details' }) }))
    );
    render(<ChartModal symbol="TEST" name="Test company" onClose={vi.fn()} />);
    expect(
      await screen.findByText('Chart data is not available right now. Try again in a few minutes.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/provider details|API returned/)).not.toBeInTheDocument();
  });
  it('cannot replace a new period with a late response from an aborted request', async () => {
    let resolveInitial;
    const initial = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(initial)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => payload({ currentPrice: { price: 201, change: 1, dataAsOf: new Date().toISOString() } }),
        })
    );
    render(<ChartModal symbol="TEST" name="Test company" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '1W' }));
    expect(await screen.findByText('$201.00')).toBeInTheDocument();
    await act(async () => {
      resolveInitial({ ok: true, json: async () => payload() });
    });
    expect(screen.getByText('$201.00')).toBeInTheDocument();
    expect(screen.queryByText('$101.00')).not.toBeInTheDocument();
  });
});
