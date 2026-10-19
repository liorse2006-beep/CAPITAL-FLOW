import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScheduledScanResultsModal from './ScheduledScanResultsModal';

function notificationWithResults(results) {
  return {
    scanType: 'capitalFlow',
    createdAt: Math.floor(Date.now() / 1000),
    body: 'The complete scan is ready.',
    results,
  };
}

describe('ScheduledScanResultsModal', () => {
  const sectorRows = [
    { symbol: 'XLK', price: 42, change: 1.25, volRatio: 1.8, flow: 'inflow', dataStatus: 'partial' },
    { symbol: 'XLE', price: 85, change: -1.5, volRatio: 2.1, flow: 'outflow', dataStatus: 'complete' },
  ];

  it('opens the saved Hot Sectors snapshot with sector names, activity and the sector volume ratio', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      render(
        <ScheduledScanResultsModal
          notification={{ ...notificationWithResults(sectorRows), scanType: 'sectorMoving', dataStatus: 'partial' }}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByRole('dialog', { name: 'Hot Sectors results' })).toBeInTheDocument();
      expect(screen.getByText('Technology')).toBeInTheDocument();
      expect(screen.getByText('Energy')).toBeInTheDocument();
      expect(screen.getByText('Positive activity')).toBeInTheDocument();
      expect(screen.getByText('Negative activity')).toBeInTheDocument();
      expect(screen.getByText('$42.00')).toBeInTheDocument();
      expect(screen.getByText('1.80x')).toBeInTheDocument();
      expect(screen.getByText('2.10x')).toBeInTheDocument();
      expect(screen.queryByText('Market cap')).not.toBeInTheDocument();
      expect(screen.getByText('New market signal detected. Open Capital Flow to view it.')).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('switches between two sector alerts without replacing their saved values with current market data', () => {
    const view = render(
      <ScheduledScanResultsModal
        notification={{ ...notificationWithResults(sectorRows), scanType: 'sectorMoving' }}
        onClose={vi.fn()}
      />
    );
    view.rerender(
      <ScheduledScanResultsModal
        notification={{
          ...notificationWithResults([{ ...sectorRows[0], price: 51, flow: 'neutral' }]),
          scanType: 'sectorMoving',
        }}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('$42.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy')).not.toBeInTheDocument();
    expect(screen.getByText('$51.00')).toBeInTheDocument();
    expect(screen.getByText('No notable change')).toBeInTheDocument();
  });

  it('does not mislabel old stock-only alerts as sector results or silently fetch a new scan', () => {
    render(
      <ScheduledScanResultsModal
        notification={{
          ...notificationWithResults([{ symbol: 'CZR', price: 28.8, volumeRatio: 2.81 }]),
          scanType: 'sectorMoving',
        }}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('CZR')).not.toBeInTheDocument();
    expect(screen.getByText("This older alert doesn't include a saved sector scan.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Hot Sectors to run a new scan' })).toHaveAttribute('href', '/flow');
  });

  it('keeps an empty sector run empty and preserves the MA-specific result display', () => {
    const view = render(
      <ScheduledScanResultsModal
        notification={{ ...notificationWithResults([]), scanType: 'sectorMoving' }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByText("We couldn't verify a market signal this time.")).toHaveLength(2);
    view.rerender(
      <ScheduledScanResultsModal
        notification={{
          ...notificationWithResults([{ symbol: 'AAPL', price: 200, maDistance: 1.2, direction: 'above' }]),
          scanType: 'maScanner',
        }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('+1.20% from MA')).toBeInTheDocument();
    expect(screen.getByText('Market cap')).toBeInTheDocument();
  });

  it('closes on Escape using the current close handler', () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const notification = notificationWithResults([]);
    const view = render(<ScheduledScanResultsModal notification={notification} onClose={firstClose} />);
    view.rerender(<ScheduledScanResultsModal notification={notification} onClose={latestClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(latestClose).toHaveBeenCalledTimes(1);
    expect(firstClose).not.toHaveBeenCalled();
  });

  it('contains keyboard focus and restores the opener and page scrolling after close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    let view;
    try {
      view = render(
        <ScheduledScanResultsModal
          notification={notificationWithResults([{ symbol: 'ONE', price: 12 }])}
          onClose={vi.fn()}
        />
      );
      const dialog = screen.getByRole('dialog');
      const close = screen.getByRole('button', { name: 'Close' });
      const lastLink = screen.getByRole('link', { name: 'Open ONE on TradingView' });
      expect(dialog).toHaveFocus();
      expect(document.body.style.overflow).toBe('hidden');

      close.focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(lastLink).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(close).toHaveFocus();

      view.unmount();
      expect(opener).toHaveFocus();
      expect(document.body.style.overflow).toBe('auto');
    } finally {
      view?.unmount();
      opener.remove();
      document.body.style.overflow = priorOverflow;
    }
  });

  it('does not intercept keys or lock page scrolling while no notification is open', () => {
    const onClose = vi.fn();
    const priorOverflow = document.body.style.overflow;
    const view = render(<ScheduledScanResultsModal notification={null} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe(priorOverflow);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    view.rerender(<ScheduledScanResultsModal notification={notificationWithResults([])} onClose={onClose} />);
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(<ScheduledScanResultsModal notification={null} onClose={onClose} />);
    expect(document.body.style.overflow).toBe(priorOverflow);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders every result row from the notification, including rows beyond the old 50-row boundary', () => {
    const results = Array.from({ length: 120 }, (_, index) => ({
      symbol: 'SYM' + index,
      price: 10 + index,
      change: index / 10,
      volumeRatio: 2 + index / 100,
    }));

    render(<ScheduledScanResultsModal notification={notificationWithResults(results)} onClose={vi.fn()} />);

    expect(screen.getByText('SYM0')).toBeInTheDocument();
    expect(screen.getByText('SYM119')).toBeInTheDocument();
    expect(screen.getAllByText(/x$/)).toHaveLength(120);
  });

  it('keeps malformed provider values visibly unavailable instead of rendering NaN', () => {
    render(
      <ScheduledScanResultsModal
        notification={notificationWithResults([
          {
            symbol: 'BAD',
            price: 'not-a-price',
            change: 'not-a-change',
            volumeRatio: NaN,
            maDistance: 'not-a-distance',
          },
        ])}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('BAD')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a normal signal for a partial scan with one row, while explaining quality in the saved results', () => {
    render(
      <ScheduledScanResultsModal
        notification={{
          ...notificationWithResults([{ symbol: 'ONE', price: 12, maDistance: null }]),
          body: "We couldn't verify a market signal this time.",
          dataStatus: 'partial',
          dataAsOf: new Date(Date.now() - 30000).toISOString(),
        }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('ONE')).toBeInTheDocument();
    expect(screen.getByText('New market signal detected. Open Capital Flow to view it.')).toBeInTheDocument();
    expect(screen.getByText('Showing available results. Some market data was unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/Market data as of/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't verify/)).not.toBeInTheDocument();
    expect(screen.queryByText(/% from MA/)).not.toBeInTheDocument();
  });

  it.each([null, '', 'invalid', new Date(Date.now() + 300000).toISOString()])(
    'never presents an absent or invalid observation time as current: %s',
    (dataAsOf) => {
      render(
        <ScheduledScanResultsModal
          notification={{
            ...notificationWithResults([{ symbol: 'ONE', price: 12, maDistance: false }]),
            dataStatus: 'complete',
            dataAsOf,
          }}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('Market data time is unavailable.')).toBeInTheDocument();
      expect(screen.queryByText(/% from MA/)).not.toBeInTheDocument();
    }
  );

  it('uses the no-signal message only when the saved table has no rows', () => {
    render(
      <ScheduledScanResultsModal
        notification={{ ...notificationWithResults([]), body: 'New market signal detected.' }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByText("We couldn't verify a market signal this time.")).toHaveLength(2);
    expect(screen.queryByText(/New market signal/)).not.toBeInTheDocument();
  });
});
