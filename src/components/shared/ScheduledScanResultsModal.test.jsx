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
      const lastLink = screen.getByRole('link', { name: 'Open ONE in TradingView' });
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
