import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertThresholdModal from './AlertThresholdModal';

describe('AlertThresholdModal', () => {
  it('shows a type picker with the ticker symbol when there is no existing alert', () => {
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={null}
        currentPrice={190}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/ALERT · AAPL/)).toBeInTheDocument();
    expect(screen.getByText('נפח')).toBeInTheDocument();
    expect(screen.getByText('מחיר')).toBeInTheDocument();
  });

  it('goes straight to the volume step when the existing alert is a volume alert', () => {
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={{ type: 'volume', minRatio: 3.5 }}
        currentPrice={190}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByDisplayValue('3.5')).toBeInTheDocument();
  });

  it('calls onSave with a volume alert object when set from the type picker', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={null}
        currentPrice={190}
        onSave={onSave}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByText('נפח'));
    await user.type(screen.getByRole('spinbutton'), '4');
    await user.click(screen.getByRole('button', { name: 'קבע התראה' }));
    expect(onSave).toHaveBeenCalledWith({ type: 'volume', minRatio: 4 });
  });

  it('calls onSave with a price alert object, including the computed starting side', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={null}
        currentPrice={190}
        onSave={onSave}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByText('מחיר'));
    await user.type(screen.getByRole('spinbutton'), '200');
    await user.click(screen.getByRole('button', { name: 'קבע התראה' }));
    expect(onSave).toHaveBeenCalledWith({
      type: 'price',
      targetPrice: 200,
      referencePrice: 190,
      startingSide: 'below',
    });
  });

  it('calls onRemove when the current alert type is cleared to empty', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={{ type: 'volume', minRatio: 3 }}
        currentPrice={190}
        onSave={vi.fn()}
        onRemove={onRemove}
        onClose={vi.fn()}
      />
    );
    await user.clear(screen.getByRole('spinbutton'));
    await user.click(screen.getByRole('button', { name: 'הסר התראה' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('lets you switch alert type via the back link without losing the existing alert', async () => {
    const user = userEvent.setup();
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={{ type: 'volume', minRatio: 3 }}
        currentPrice={190}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByText('‹ שנה סוג התראה'));
    expect(screen.getByText('נפח')).toBeInTheDocument();
    expect(screen.getByText('מחיר')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <AlertThresholdModal
        symbol="AAPL"
        current={null}
        currentPrice={190}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking the backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <AlertThresholdModal
        symbol="AAPL"
        current={null}
        currentPrice={190}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClose={onClose}
      />
    );
    await user.click(container.querySelector('.upgrade-overlay'));
    expect(onClose).toHaveBeenCalled();
  });
});
