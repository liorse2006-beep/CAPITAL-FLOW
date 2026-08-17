import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../context/AuthContext';
import FundamentalsPage from './FundamentalsPage';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// Rendered logged-out (no vs_token in localStorage), same reasoning as
// App.test.jsx: AuthContext resolves synchronously with no network call.
function renderPage(props = {}) {
  return render(
    <AuthProvider>
      <FundamentalsPage onUpgrade={vi.fn()} onSignIn={vi.fn()} {...props} />
    </AuthProvider>
  );
}

describe('FundamentalsPage', () => {
  it('gates the lookup behind sign-in for a logged-out visitor, never showing the search UI', () => {
    renderPage();
    // The guest gate explains the feature without rendering a fake data result.
    expect(screen.getByText(/key fundamentals behind any ticker/i)).toBeInTheDocument();
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    expect(screen.queryByText(/live read/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Analyze')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Enter a ticker/)).not.toBeInTheDocument();
  });

  it('the sign-in prompt calls onSignIn, not onUpgrade, for a logged-out visitor', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onUpgrade = vi.fn();
    renderPage({ onSignIn, onUpgrade });
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalled();
    expect(onUpgrade).not.toHaveBeenCalled();
  });
});

describe('FundamentalsPage — Premium user with a lookup result', () => {
  const FAKE_RESULT = {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 190.5,
    change: 0.8,
    marketCap: 3e12,
    floatShares: 1.44e10,
    shortPercent: 0.01,
    peRatio: 31.2,
    debtToEquity: 1.45,
    revenueGrowth5Y: 8.9,
    nextEarningsDate: '2026-11-05',
    unverified: {
      floatShares: false,
      shortPercent: false,
      peRatio: true, // Finnhub failed for this one — must show "not verified", not a fake 31.2
      debtToEquity: false,
      revenueGrowth5Y: false,
      nextEarningsDate: false,
    },
  };

  function renderPremiumPage() {
    localStorage.setItem('vs_token', 'fake-token');
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user: { id: 1, email: 'p@test.local', tier: 'premium', is_premium: true } }),
        });
      }
      if (String(url).includes('/api/auth/refresh')) {
        return Promise.resolve({ ok: false });
      }
      if (String(url).includes('/api/fundamentals')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: FAKE_RESULT }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    const utils = render(
      <AuthProvider>
        <FundamentalsPage onUpgrade={vi.fn()} onSignIn={vi.fn()} />
      </AuthProvider>
    );
    return { ...utils, fetchMock };
  }

  it('starts with no attribute selected, so a lookup shows the empty-selection hint rather than every tile', async () => {
    const user = userEvent.setup();
    renderPremiumPage();

    await screen.findByPlaceholderText(/Enter a ticker/);
    // None of the six toggle buttons should read as pressed before the
    // customer has touched any of them.
    expect(screen.getByRole('button', { name: 'Float' })).toHaveAttribute('aria-pressed', 'false');

    await user.type(screen.getByPlaceholderText(/Enter a ticker/), 'AAPL');
    await user.click(screen.getByText('Analyze'));

    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
    expect(screen.getByText(/No metrics selected/)).toBeInTheDocument();
    expect(screen.queryByText('1.45')).not.toBeInTheDocument();
  });

  it('runs a lookup and shows the result, with an unverified field flagged distinctly instead of a value', async () => {
    const user = userEvent.setup();
    renderPremiumPage();

    await screen.findByPlaceholderText(/Enter a ticker/);
    await user.type(screen.getByPlaceholderText(/Enter a ticker/), 'AAPL');
    await user.click(screen.getByText('Analyze'));

    // 'AAPL' text now also appears in the Recent chip added by this same
    // lookup — wait on the company name instead, which stays unique.
    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
    // Nothing is selected by default — turn every tile on to check them.
    await user.click(screen.getByRole('button', { name: /select all/i }));

    expect(screen.getByText('Not verified — try again in a few minutes')).toBeInTheDocument();
    // A field Finnhub actually answered must never be replaced by the
    // unverified message — only the one flagged unverified is.
    expect(screen.queryByText('31.20')).not.toBeInTheDocument();
    expect(screen.getByText('1.45')).toBeInTheDocument();
  });

  it('deselecting a metric hides its tile, and Select all brings every tile back', async () => {
    const user = userEvent.setup();
    renderPremiumPage();

    await screen.findByPlaceholderText(/Enter a ticker/);
    await user.type(screen.getByPlaceholderText(/Enter a ticker/), 'AAPL');
    await user.click(screen.getByText('Analyze'));
    await screen.findByText('Apple Inc.');

    // Nothing is selected by default — select everything first so this
    // test can exercise deselecting a single one against a known baseline.
    await user.click(screen.getByRole('button', { name: /select all/i }));

    // "Debt / Equity" appears twice while its tile is shown: the filter chip
    // and the result tile. Deselecting removes the tile, leaving just the chip.
    expect(screen.getAllByText('Debt / Equity')).toHaveLength(2);
    // Toggle the chip off via its accessible name (the check glyph is
    // aria-hidden, so the button's name is just the metric label).
    await user.click(screen.getByRole('button', { name: /^Debt \/ Equity$/ }));
    expect(screen.getAllByText('Debt / Equity')).toHaveLength(1);

    // With one deselected the batch button reads "Select all" — clicking it
    // restores every tile.
    await user.click(screen.getByRole('button', { name: /select all/i }));
    expect(screen.getAllByText('Debt / Equity')).toHaveLength(2);
  });

  it('a successful lookup adds a Recent chip, and clicking it re-runs the lookup for that ticker', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderPremiumPage();

    await screen.findByPlaceholderText(/Enter a ticker/);
    await user.type(screen.getByPlaceholderText(/Enter a ticker/), 'AAPL');
    await user.click(screen.getByText('Analyze'));
    await screen.findByText('Apple Inc.');

    const chip = screen.getByRole('button', { name: 'AAPL' });
    expect(chip).toBeInTheDocument();

    fetchMock.mockClear();
    await user.click(chip);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/fundamentals?symbol=AAPL'), expect.anything());
  });
});

describe("FundamentalsPage — free-tier access mirrors the server's trial gate", () => {
  function renderAsUser(meUser) {
    localStorage.setItem('vs_token', 'fake-token');
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: meUser }) });
      }
      if (String(url).includes('/api/auth/refresh')) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    return render(
      <AuthProvider>
        <FundamentalsPage onUpgrade={vi.fn()} onSignIn={vi.fn()} />
      </AuthProvider>
    );
  }

  it('shows the real search UI for a free account still inside its 7-day trial (elite_access true)', async () => {
    renderAsUser({ id: 2, email: 'trial@test.local', tier: 'free', is_premium: false, elite_access: true });
    expect(await screen.findByPlaceholderText(/Enter a ticker/)).toBeInTheDocument();
    expect(screen.queryByText(/swing decision/i)).not.toBeInTheDocument();
  });

  it('still shows the upsell for a free account whose trial has ended (elite_access false)', async () => {
    renderAsUser({ id: 3, email: 'expired@test.local', tier: 'free', is_premium: false, elite_access: false });
    expect(await screen.findByText(/key fundamentals behind any ticker/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Enter a ticker/)).not.toBeInTheDocument();
  });
});
