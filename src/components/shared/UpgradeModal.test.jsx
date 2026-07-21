import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UpgradeModal from './UpgradeModal';
import { AuthProvider } from '../../context/AuthContext';

function renderWithProviders(ui) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

describe('UpgradeModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows Your plan under the users current tier and a CTA for tiers above it', () => {
    renderWithProviders(<UpgradeModal userTier="premium" onClose={vi.fn()} />);
    expect(screen.getByText('Your plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get elite/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /get premium/i })).not.toBeInTheDocument();
  });

  it('shows the base prices', () => {
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);
    expect(screen.getByText('$14.90')).toBeInTheDocument();
    expect(screen.getByText('$29.90')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(<UpgradeModal userTier="free" onClose={onClose} />);
    container.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('goes straight to Whop checkout with no confirmation screen', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ purchaseUrl: 'https://whop.com/checkout/plan_test/?session=ch_test' }),
      })
    );
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/checkout/transaction',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tier: 'premium' }) })
      )
    );
    expect(screen.queryByText(/continue to payment/i)).not.toBeInTheDocument();
  });
});
