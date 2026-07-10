import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UpgradeModal from './UpgradeModal';

describe('UpgradeModal', () => {
  it('shows Your plan under the users current tier and a CTA for tiers above it', () => {
    render(<UpgradeModal userTier="premium" onClose={vi.fn()} />);
    expect(screen.getByText('Your plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get elite/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /get premium/i })).not.toBeInTheDocument();
  });

  it('shows the base prices', () => {
    render(<UpgradeModal userTier="free" onClose={vi.fn()} />);
    expect(screen.getByText('$14.90')).toBeInTheDocument();
    expect(screen.getByText('$29.90')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    const { container } = render(<UpgradeModal userTier="free" onClose={onClose} />);
    container.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
