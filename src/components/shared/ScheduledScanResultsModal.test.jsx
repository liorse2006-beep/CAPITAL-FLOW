import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
