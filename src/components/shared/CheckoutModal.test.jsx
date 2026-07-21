import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CheckoutModal from './CheckoutModal';
import { AuthProvider } from '../../context/AuthContext';

function renderWithProviders(ui) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

describe('CheckoutModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows the base price for the selected tier', () => {
    renderWithProviders(<CheckoutModal tier="premium" onClose={vi.fn()} />);
    expect(screen.getByText('$14.90')).toBeInTheDocument();
  });

  it('shows the "Continue to Payment" button', () => {
    renderWithProviders(<CheckoutModal tier="elite" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeInTheDocument();
  });

  it('applies a coupon and shows the discounted price', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ valid: true, code: 'SAVE10', discountPercent: 10 }),
      })
    );
    renderWithProviders(<CheckoutModal tier="premium" onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Have a coupon?'), 'save10');
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(screen.getByText('✓ SAVE10 applied')).toBeInTheDocument());
    expect(screen.getByText('$13.41')).toBeInTheDocument(); // 14.90 * 0.9
    expect(screen.getByText('$14.90')).toBeInTheDocument(); // struck-through original
  });

  it('shows an error for an invalid coupon', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => ({ valid: false, error: 'Invalid coupon code' }) })
    );
    renderWithProviders(<CheckoutModal tier="premium" onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Have a coupon?'), 'NOPE');
    await user.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(screen.getByText('Invalid coupon code')).toBeInTheDocument());
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(<CheckoutModal tier="premium" onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
