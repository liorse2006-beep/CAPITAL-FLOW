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
    expect(screen.getByText('התחברות')).toBeInTheDocument();
    expect(screen.getByText(/בחירת מסלול/i)).toBeInTheDocument();
  });

  it('shows an Upgrade Subscription button (no Sign In) for a logged-in free user', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' } })} />);
    expect(screen.queryByText('התחברות')).not.toBeInTheDocument();
    expect(screen.getByText(/בחירת מסלול/i)).toBeInTheDocument();
  });

  it('shows a PREMIUM badge and Upgrade to Elite button for premium users', () => {
    const onUpgrade = vi.fn();
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isPremium: true, onUpgrade })} />);
    expect(screen.getByRole('button', { name: 'פתיחת מסלולים' })).toBeInTheDocument();
    expect(screen.getByText(/שדרוג ל־Elite/i)).toBeInTheDocument();
    screen.getByRole('button', { name: 'פתיחת מסלולים' }).click();
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('makes the FREE TRIAL tier badge open the upgrade table', () => {
    const onUpgrade = vi.fn();
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isTrial: true, onUpgrade })} />);

    const trialBadge = screen.getByRole('button', { name: 'פתיחת מסלולים' });
    expect(trialBadge).toHaveTextContent('ניסיון חינם');
    trialBadge.click();
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('shows an ELITE EDITION badge with no upgrade button for elite users', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'a@b.com' }, isPremium: true, isElite: true })} />);
    expect(screen.getByText('מסלול Elite')).toBeInTheDocument();
    expect(screen.queryByText(/שדרוג ל־Elite/i)).not.toBeInTheDocument();
  });

  it('shows the Admin link only for the configured admin user and never exposes a Status link', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'admin@example.com', is_admin: true } })} />);
    const adminLink = screen.getByRole('link', { name: 'ניהול' });
    expect(adminLink).toHaveAttribute('href', '/admin');
    expect(adminLink).not.toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('does not show Admin or Status links to regular users', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' } })} />);
    expect(screen.queryByRole('link', { name: 'ניהול' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('shows the default person avatar and opens the profile entry point', () => {
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' } })} />);

    expect(screen.getByRole('img', { name: 'user@example.com profile picture' })).toHaveAttribute(
      'src',
      '/default-avatar.svg'
    );

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    expect(screen.getByRole('menu', { name: 'תפריט החשבון' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' })).toHaveAttribute('aria-controls', 'profile-menu');

    fireEvent.click(screen.getByRole('menuitem', { name: 'החשבון וסביבת העבודה' }));
    expect(screen.getByRole('dialog', { name: 'מרכז החשבון' })).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('closes Account Center before opening the current upgrade plans', async () => {
    const onUpgrade = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' }, onUpgrade })} />);

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'החשבון וסביבת העבודה' }));
    fireEvent.click(await screen.findByRole('button', { name: 'הצגת אפשרויות שדרוג' }));

    expect(onUpgrade).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'מרכז החשבון' })).not.toBeInTheDocument();
  });

  it('exposes direct destinations for every profile area', async () => {
    const onOpenScheduling = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' }, onOpenScheduling })} />);

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    for (const label of ['החשבון וסביבת העבודה', 'תזמונים והתראות', 'אבטחה ופרטיות']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('menuitem', { name: 'החשבון וסביבת העבודה' }));
    expect(screen.getByRole('dialog', { name: 'מרכז החשבון' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'פרטי החשבון' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'מסלול וגישה' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'הפעילות שלך' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'סגירת פרטי החשבון' }));
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'תזמונים והתראות' }));
    expect(screen.getByRole('dialog', { name: 'מרכז החשבון' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תזמונים והתראות' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תזמון סריקות' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'התראות' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'תזמון סריקות' }));
    expect(onOpenScheduling).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'אבטחה ופרטיות' }));
    expect(screen.getByRole('heading', { name: 'אבטחה ופרטיות' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'אבטחה והתחברות' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'פרטיות ונתונים' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הורדת הנתונים שלי' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מחיקת חשבון' })).toBeInTheDocument();
  });

  it('places the red Log Out action inside the profile menu', () => {
    const logout = vi.fn();
    render(<Topbar {...baseProps({ user: { id: 1, email: 'user@example.com' }, logout })} />);

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    const logoutItem = screen.getByRole('menuitem', { name: 'התנתקות' });
    expect(logoutItem).toHaveClass('topbar-profile-menu-item--danger');

    fireEvent.click(logoutItem);
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu', { name: 'תפריט החשבון' })).not.toBeInTheDocument();
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

  it('keeps the alert trigger and panel linked for assistive technology', () => {
    render(
      <Topbar
        {...baseProps({
          user: { id: 1, email: 'user@example.com' },
          showAlertPanel: true,
        })}
      />
    );

    const bell = screen.getByRole('button', { name: 'היסטוריית התראות' });
    const panel = screen.getByRole('dialog', { name: 'התראות' });

    expect(bell).toHaveAttribute('aria-controls', 'alert-history-panel');
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveAttribute('id', 'alert-history-panel');
    expect(panel.parentElement).toHaveClass('alert-bell-wrap');
  });

  it('keeps the profile and notification surfaces from occupying the same mobile layer', () => {
    const onClosePanel = vi.fn();
    const onBellClick = vi.fn();

    const { rerender } = render(
      <Topbar
        {...baseProps({
          user: { id: 1, email: 'user@example.com' },
          showAlertPanel: true,
          onClosePanel,
          onBellClick,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    expect(onClosePanel).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu', { name: 'תפריט החשבון' })).toBeInTheDocument();

    rerender(
      <Topbar
        {...baseProps({
          user: { id: 1, email: 'user@example.com' },
          showAlertPanel: false,
          onClosePanel,
          onBellClick,
        })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט החשבון' }));
    fireEvent.click(screen.getByRole('button', { name: 'היסטוריית התראות' }));
    expect(onBellClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu', { name: 'תפריט החשבון' })).not.toBeInTheDocument();
  });
});

describe('Topbar nav tabs', () => {
  it('marks the active page tab', () => {
    render(<Topbar {...baseProps({ page: 'watchlist' })} />);
    const watchlistTab = screen.getByText('רשימת מעקב').closest('button');
    expect(watchlistTab.className).toMatch(/active/);
  });

  // A numeric badge on the Watchlist tab used to show how many tickers are
  // starred — removed because it read as an unread-style notification badge
  // (the same visual language as the alert bell's unread count), making
  // customers think something needed their attention when nothing had
  // actually happened.
  it('never shows a numeric badge on the Watchlist tab', () => {
    render(<Topbar {...baseProps({ page: 'watchlist' })} />);
    const watchlistTab = screen.getByText('רשימת מעקב').closest('button');
    expect(watchlistTab.querySelector('.tab-badge')).toBeNull();
  });
});
