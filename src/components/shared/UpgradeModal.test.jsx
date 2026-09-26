import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UpgradeModal from './UpgradeModal';
import { AuthProvider } from '../../context/AuthContext';

const checkoutReturnMocks = vi.hoisted(() => ({
  redirectToWhopReturn: vi.fn(),
  saveWhopReturnState: vi.fn(),
  clearWhopReturnState: vi.fn(),
}));

vi.mock('../../utils/checkoutReturn', () => ({
  createWhopReturnUrl: () => `${window.location.origin}/?status=success`,
  ...checkoutReturnMocks,
}));

// The real Whop SDK loads a hosted frame, which jsdom cannot exercise. These
// stubs verify our plan, signed metadata, return URL, retry and safe error UI.
vi.mock('@whop/elements', () => ({ loadWhop: () => Promise.resolve(() => ({})) }));
vi.mock('@whop/elements-react', () => ({
  WhopElements: (props) => (
    <div data-testid="whop-elements">
      <button
        type="button"
        onClick={() => props.onLoadError(new Error('raw loader detail'), vi.fn())}
      >
        Simulate loader failure
      </button>
      {props.children}
    </div>
  ),
  Checkout: (props) => (
    <div
      data-testid="whop-elements-checkout"
      data-plan={props.plan}
      data-metadata={JSON.stringify(props.metadata)}
      data-return-url={props.returnUrl}
      data-analytics={String(props.analytics)}
    >
      {props.children}
      <button
        type="button"
        onClick={() => props.onComplete({ result: 'payment', paymentId: 'pay_test', sessionId: 'chs_test' })}
      >
        Simulate payment complete
      </button>
    </div>
  ),
  CheckoutElement: (props) => (
    <div
      data-testid="whop-checkout-element"
      data-buyer-email={props.buyerEmail}
      data-lock-buyer-email={String(props.lockBuyerEmail)}
    >
      <button type="button" onClick={() => props.onError({ message: 'raw processor detail' })}>
        Simulate checkout error
      </button>
    </div>
  ),
}));

vi.mock('../../context/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ getToken: () => 'test-access-token', user: { email: 'customer@example.com' } }),
}));

const signedCheckoutResponse = (tier = 'premium', planId = `plan_${tier}_test`) => ({
  planId,
  tier,
  metadata: {
    userId: '7',
    tier,
    checkoutVersion: 'elements-v1',
    metadataSignature: 'x'.repeat(43),
  },
});

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
    checkoutReturnMocks.redirectToWhopReturn.mockClear();
    checkoutReturnMocks.saveWhopReturnState.mockClear();
    checkoutReturnMocks.clearWhopReturnState.mockClear();
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

  it('mounts Whop Elements inline with the server plan, signed metadata and safe return URL', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => signedCheckoutResponse(),
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
    const checkout = await screen.findByTestId('whop-elements-checkout');
    expect(checkout).toHaveAttribute('data-plan', 'plan_premium_test');
    expect(JSON.parse(checkout.getAttribute('data-metadata'))).toMatchObject({
      userId: '7',
      tier: 'premium',
      checkoutVersion: 'elements-v1',
      metadataSignature: 'x'.repeat(43),
    });
    expect(checkout).toHaveAttribute('data-return-url', `${window.location.origin}/?status=success`);
    expect(checkout).toHaveAttribute('data-analytics', 'false');
    expect(await screen.findByTestId('whop-checkout-element')).toHaveAttribute('data-buyer-email', 'customer@example.com');
    expect(screen.getByTestId('whop-checkout-element')).toHaveAttribute('data-lock-buyer-email', 'true');
    expect(window.location.href).not.toContain('whop.com');
  });

  it('shows confirmation after payment while Whop returns to the webhook-backed app flow', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => signedCheckoutResponse(),
      })
    );
    const onClose = vi.fn();
    renderWithProviders(<UpgradeModal userTier="free" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));
    await screen.findByTestId('whop-elements-checkout');
    await user.click(screen.getByRole('button', { name: 'Simulate payment complete' }));

    expect(await screen.findByText(/Payment received\. We’re confirming your access now/)).toBeInTheDocument();
    expect(checkoutReturnMocks.redirectToWhopReturn).toHaveBeenCalledWith(
      `${window.location.origin}/?status=success`
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders one complete Whop checkout surface for card and eligible payment methods', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => signedCheckoutResponse(),
      })
    );
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));

    expect(await screen.findByTestId('whop-elements-checkout')).toBeInTheDocument();
    expect(screen.getAllByTestId('whop-elements-checkout')).toHaveLength(1);
    expect(screen.getByTestId('whop-checkout-element')).toBeInTheDocument();
  });

  it('starts checkout without exposing a legacy promo-code field', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => signedCheckoutResponse(),
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
    expect(await screen.findByTestId('whop-elements-checkout')).toBeInTheDocument();
    expect(screen.queryByText(/promo code/i)).not.toBeInTheDocument();
  });

  it('stashes the requested tier before mounting the embed, so the welcome screen knows what was bought', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => signedCheckoutResponse('elite'),
      })
    );
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /get elite/i }));

    await waitFor(() => expect(localStorage.getItem('vs_pending_tier')).toBe('elite'));
    expect(await screen.findByTestId('whop-elements-checkout')).toHaveAttribute('data-plan', 'plan_elite_test');
  });

  it('clears the pending tier handoff when checkout is explicitly closed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => signedCheckoutResponse(),
      })
    );
    const onClose = vi.fn();
    renderWithProviders(<UpgradeModal userTier="free" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));
    await screen.findByTestId('whop-elements-checkout');
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
    expect(screen.queryByTestId('whop-elements-checkout')).not.toBeInTheDocument();
  });

  it('does not show raw provider error text to the customer', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => signedCheckoutResponse() })
    );
    renderWithProviders(<UpgradeModal userTier="free" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /get premium/i }));
    await screen.findByTestId('whop-checkout-element');
    await user.click(screen.getByRole('button', { name: 'Simulate checkout error' }));

    expect(await screen.findByText('Secure checkout is temporarily unavailable. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('raw processor detail')).not.toBeInTheDocument();
  });
});
