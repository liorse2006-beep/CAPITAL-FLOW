import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UpgradeModal from './UpgradeModal';
import { AuthProvider } from '../../context/AuthContext';

// The real WhopCheckoutEmbed mounts an iframe pointed at Whop's own servers
// — not something jsdom can (or should) exercise. Stubbed to a simple marker
// so these tests verify OUR wiring (session creation, prop pass-through,
// onComplete handling) without depending on Whop's actual embed internals.
vi.mock('@whop/checkout/react', () => ({
  WhopCheckoutEmbed: (props) => (
    <div data-testid="whop-checkout-embed" data-session-id={props.sessionId}>
      <button onClick={() => props.onComplete('plan_x', 'receipt_x', {})}>Simulate payment complete</button>
    </div>
  ),
}));

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

  it('mounts the checkout inline (embedded) instead of redirecting to a Whop-hosted page', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: 'ch_test123', planId: 'plan_test' }),
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
    const embed = await screen.findByTestId('whop-checkout-embed');
    expect(embed).toHaveAttribute('data-session-id', 'ch_test123');
    // Never navigated away — this is the whole point of the embed.
    expect(window.location.href).not.toContain('whop.com');
  });

  it('stashes the requested tier before mounting the embed, so the welcome screen knows what was bought', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: 'ch_test123', planId: 'plan_test' }),
      })
    );
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /get elite/i }));

    await waitFor(() => expect(localStorage.getItem('vs_pending_tier')).toBe('elite'));
  });

  it('shows a real error and stays on the plan table when the session can not be created', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Whop is not configured yet' }) })
    );
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));

    expect(await screen.findByText('Whop is not configured yet')).toBeInTheDocument();
    expect(screen.queryByTestId('whop-checkout-embed')).not.toBeInTheDocument();
  });
});
