import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertThresholdModal from './AlertThresholdModal';

describe('AlertThresholdModal', () => {
  it('shows the ticker symbol in the title', () => {
    render(<AlertThresholdModal symbol="AAPL" current={null} onSave={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Alert — AAPL/)).toBeInTheDocument();
  });

  it('pre-fills the input with the current threshold', () => {
    render(<AlertThresholdModal symbol="AAPL" current={3.5} onSave={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue('3.5')).toBeInTheDocument();
  });

  it('calls onSave with a parsed number when a valid threshold is submitted', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AlertThresholdModal symbol="AAPL" current={null} onSave={onSave} onRemove={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByRole('spinbutton'), '4');
    await user.click(screen.getByRole('button', { name: /save alert/i }));
    expect(onSave).toHaveBeenCalledWith(4);
  });

  it('calls onRemove when submitted empty', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <AlertThresholdModal symbol="AAPL" current={3} onSave={vi.fn()} onRemove={onRemove} onClose={vi.fn()} />
    );
    await user.clear(screen.getByRole('spinbutton'));
    await user.click(screen.getByRole('button', { name: /remove alert/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<AlertThresholdModal symbol="AAPL" current={null} onSave={vi.fn()} onRemove={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking the backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <AlertThresholdModal symbol="AAPL" current={null} onSave={vi.fn()} onRemove={vi.fn()} onClose={onClose} />
    );
    await user.click(container.querySelector('.upgrade-overlay'));
    expect(onClose).toHaveBeenCalled();
  });
});
