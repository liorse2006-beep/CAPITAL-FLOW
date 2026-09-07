import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TierComparisonMatrix from './TierComparisonMatrix';

describe('TierComparisonMatrix', () => {
  it('renders the shared paid-plan comparison without retired Capi copy', () => {
    render(<TierComparisonMatrix userTier="free" onCheckout={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Premium' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elite' })).toBeInTheDocument();
    expect(screen.getByText('$14.90')).toBeInTheDocument();
    expect(screen.getByText('$29.90')).toBeInTheDocument();
    expect(screen.getAllByText('Capital Flow Radar')).toHaveLength(2);
    expect(screen.queryByText(/CAPI\s*-\s*AI\s*MENTOR/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/news\s*&\s*ai\s*summaries/i)).not.toBeInTheDocument();
  });
});
