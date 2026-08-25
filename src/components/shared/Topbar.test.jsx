import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    const onUpgrade = vi.fn();
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isPremium: true, onUpgrade })} />);
    expect(screen.getByRole('button', { name: 'Open upgrade plans' })).toBeInTheDocument();
    expect(screen.getByText(/upgrade to elite/i)).toBeInTheDocument();
    screen.getByRole('button', { name: 'Open upgrade plans' }).click();
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('makes the FREE TRIAL tier badge open the upgrade table', () => {
    const onUpgrade = vi.fn();
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isTrial: true, onUpgrade })} />);

    const trialBadge = screen.getByRole('button', { name: 'Open upgrade plans' });
    expect(trialBadge).toHaveTextContent('FREE TRIAL');
    trialBadge.click();
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('shows an ELITE EDITION badge with no upgrade button for elite users', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isPremium: true, isElite: true })} />);
    expect(screen.getByText('ELITE EDITION')).toBeInTheDocument();
    expect(screen.queryByText(/upgrade to elite/i)).not.toBeInTheDocument();
  });

  it('shows Admin and Status links only for the configured admin user', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'admin@example.com', is_admin: true } })} />);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute(
      'href',
      'https://status.capitalflow.vip/status'
    );
  });

  it('does not show Admin or Status links to regular users', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' } })} />);
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('shows the default logo avatar and opens the profile entry point', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' } })} />);

    expect(screen.getByRole('img', { name: 'user@example.com profile picture' })).toHaveAttribute(
      'src',
      '/icon-192.png'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open profile menu' }));
    expect(screen.getByRole('menu', { name: 'Profile menu' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(screen.getByRole('dialog', { name: 'Your Profile' })).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('uses the Google profile image when the account provides one', () => {
    render(
      <Topbar
        {...baseProps({
          user: { id: 1, email: 'google@example.com', avatar_url: 'https://lh3.googleusercontent.com/avatar' },
        })}
      />
    );

    expect(screen.getByRole('img', { name: 'google@example.com profile picture' })).toHaveAttribute(
      'src',
      'https://lh3.googleusercontent.com/avatar'
    );
  });
});

describe('Topbar nav tabs', () => {
  it('marks the active page tab', () => {
    render(<Topbar {...baseProps({ page: 'watchlist' })} />);
    const watchlistTab = screen.getByText('Watchlist').closest('button');
    expect(watchlistTab.className).toMatch(/active/);
  });

  // A numeric badge on the Watchlist tab used to show how many tickers are
  // starred — removed because it read as an unread-style notification badge
  // (the same visual language as the alert bell's unread count), making
  // customers think something needed their attention when nothing had
  // actually happened.
  it('never shows a numeric badge on the Watchlist tab', () => {
    render(<Topbar {...baseProps({ page: 'watchlist' })} />);
    const watchlistTab = screen.getByText('Watchlist').closest('button');
    expect(watchlistTab.querySelector('.tab-badge')).toBeNull();
  });
});
