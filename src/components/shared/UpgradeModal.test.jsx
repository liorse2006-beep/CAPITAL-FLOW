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
    <div data-testid="whop-checkout-embed" data-session-id={props.sessionId} data-return-url={props.returnUrl}>
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
    const { container } = renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);
    expect(screen.getByText('$14.90')).toBeInTheDocument();
    expect(screen.getByText('$29.90')).toBeInTheDocument();
    expect(screen.queryByText('Free', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/promo code/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('PROMO CODE')).not.toBeInTheDocument();
    expect(screen.getAllByText('One-time purchase · Lifetime access')).toHaveLength(2);
    expect(container.querySelector('.tier-matrix')).toBeInTheDocument();
    expect(container.querySelector('.upgrade-plan-options')).toBeNull();
    expect(screen.getAllByText(/Full market scans/)).toHaveLength(2);
    expect(screen.getAllByText(/5 scans \/ 24h \(shared\)/)).toHaveLength(1);
    expect(
      [...container.querySelectorAll('.tier-matrix-feature-specific')].filter((element) =>
        element.textContent.includes('Unlimited')
      )
    ).toHaveLength(4);
    expect(screen.queryByText('Included', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Not included', { exact: true })).not.toBeInTheDocument();
  });

  it('shows the post-trial value proposition with only the paid paths', () => {
    renderWithProviders(<UpgradeModal userTier="free" trialEnded onClose={vi.fn()} />);
    expect(screen.getByText(/keep your edge after the trial/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep scanning with premium/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock elite/i })).toBeInTheDocument();
    expect(screen.queryByText('Explore the basics')).not.toBeInTheDocument();
    expect(screen.getByText('One payment')).toBeInTheDocument();
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
    expect(embed).toHaveAttribute('data-return-url', `${window.location.origin}/`);
    // Never navigated away — this is the whole point of the embed.
    expect(window.location.href).not.toContain('whop.com');
  });

  it('closes the checkout when payment completes so the post-purchase handoff is unobstructed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: 'ch_test123', planId: 'plan_test' }),
      })
    );
    const onClose = vi.fn();
    renderWithProviders(<UpgradeModal userTier="free" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));
    await screen.findByTestId('whop-checkout-embed');
    await user.click(screen.getByRole('button', { name: 'Simulate payment complete' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders one session-bound checkout for wallets and card payments', async () => {
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

    expect(await screen.findByTestId('whop-checkout-embed')).toBeInTheDocument();
    expect(screen.queryByTestId('whop-express-button')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('whop-checkout-embed')).toHaveLength(1);
  });

  it('starts checkout without exposing a legacy promo-code field', async () => {
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
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ tier: 'premium' }),
        })
      )
    );
    expect(await screen.findByTestId('whop-checkout-embed')).toBeInTheDocument();
    expect(screen.queryByText(/promo code/i)).not.toBeInTheDocument();
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

  it('clears the pending tier handoff when checkout is explicitly closed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: 'ch_test123', planId: 'plan_test' }),
      })
    );
    const onClose = vi.fn();
    renderWithProviders(<UpgradeModal userTier="free" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));
    await screen.findByTestId('whop-checkout-embed');
    expect(localStorage.getItem('vs_pending_tier')).toBe('premium');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(localStorage.getItem('vs_pending_tier')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a real error and stays on the plan selector when the session can not be created', async () => {
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
