import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProfileModal from './ProfileModal';

const user = {
  id: 42,
  email: 'profile@example.com',
  tier: 'elite',
  auth_provider: 'Email and password',
  is_verified: true,
  created_at: '2026-01-01 12:00:00',
};

function summaryResponse() {
  return {
    ok: true,
    json: async () => ({
      user,
      plan: { access: 'Full access', trialActive: false, trialEndsAt: null },
      usage: {
        watchlistCount: 2,
        alertCount: 1,
        scheduleCount: 1,
        activeScheduleCount: 1,
        radarCount: 1,
        activeRadarCount: 1,
        pushDeviceCount: 0,
        chatMessageCount: 3,
        quota: { tier: 'elite' },
      },
      security: { authProvider: 'Email and password', activeSessionCount: 1 },
    }),
  };
}

function renderProfile(overrides = {}) {
  const props = {
    user,
    getToken: vi.fn(() => 'token'),
    onClose: vi.fn(),
    onPasswordChanged: vi.fn(),
    onAccountDeleted: vi.fn(),
    onOpenScheduling: vi.fn(),
    canNotify: true,
    pushSupported: true,
    notificationApiSupported: true,
    notificationPermission: 'default',
    pushEnabled: false,
    pushBusy: false,
    pushError: null,
    onEnablePush: vi.fn(() => Promise.resolve()),
    onDisablePush: vi.fn(() => Promise.resolve()),
    onUpgrade: vi.fn(),
    ...overrides,
  };
  return { ...render(<ProfileModal {...props} />), props };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ProfileModal preferences', () => {
  it('asks for confirmation before enabling notifications', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile();

    expect(await screen.findByText('Your workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Allow notifications on this device?');
    expect(props.onEnablePush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(props.onEnablePush).toHaveBeenCalledOnce();
  });

  it('asks for confirmation before disabling notifications', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile({ pushEnabled: true, notificationPermission: 'granted' });

    expect(await screen.findByText('Your workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disable notifications' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Disable notifications on this device?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onDisablePush).not.toHaveBeenCalled();
  });

  it('opens the existing scanner scheduler from the single scheduling button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile();

    expect(await screen.findByText('Your workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule scans' }));
    expect(props.onOpenScheduling).toHaveBeenCalledOnce();
  });
});
