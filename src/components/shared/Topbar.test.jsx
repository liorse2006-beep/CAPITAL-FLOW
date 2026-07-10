import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Topbar from './Topbar';

function baseProps(overrides = {}) {
  return {
    user: null,
    isElite: false,
    isPremium: false,
    getToken: vi.fn(),
    logout: vi.fn(),
    page: 'scanner',
    results: null,
    scanning: false,
    scanMeta: null,
    onNewScan: vi.fn(),
    onUpgrade: vi.fn(),
    onSignIn: vi.fn(),
    notificationsEnabled: false,
    showAlertPanel: false,
    onBellClick: vi.fn(),
    unreadCount: 0,
    alertHistory: [],
    onClearAll: vi.fn(),
    onClosePanel: vi.fn(),
    onRemoveAlert: vi.fn(),
    onToggleNotifications: vi.fn(),
    setPage: vi.fn(),
    watchlistCount: 0,
    ...overrides,
  };
}

describe('Topbar tier badge', () => {
  it('shows Sign In + Upgrade Subscription for a logged-out visitor', () => {
    render(<Topbar {...baseProps()} />);
    expect(screen.getByText('Sign In')).toBeInTheDocument();
    expect(screen.getByText(/upgrade subscription/i)).toBeInTheDocument();
  });

  it('shows an Upgrade Subscription button (no Sign In) for a logged-in free user', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' } })} />);
    expect(screen.queryByText('Sign In')).not.toBeInTheDocument();
    expect(screen.getByText(/upgrade subscription/i)).toBeInTheDocument();
  });

  it('shows a PREMIUM badge and Upgrade to Elite button for premium users', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isPremium: true })} />);
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
    expect(screen.getByText(/upgrade to elite/i)).toBeInTheDocument();
  });

  it('shows an ELITE EDITION badge with no upgrade button for elite users', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isPremium: true, isElite: true })} />);
    expect(screen.getByText('ELITE EDITION')).toBeInTheDocument();
    expect(screen.queryByText(/upgrade to elite/i)).not.toBeInTheDocument();
  });
});

describe('Topbar nav tabs', () => {
  it('marks the active page tab and shows the watchlist badge count', () => {
    render(<Topbar {...baseProps({ page: 'watchlist', watchlistCount: 3 })} />);
    const watchlistTab = screen.getByText('Watchlist').closest('button');
    expect(watchlistTab.className).toMatch(/active/);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
