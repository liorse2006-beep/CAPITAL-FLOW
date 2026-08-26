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

    expect(await screen.findByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Automation & alerts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Allow notifications on this device?');
    expect(props.onEnablePush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(props.onEnablePush).toHaveBeenCalledOnce();
  });

  it('asks for confirmation before disabling notifications', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile({ pushEnabled: true, notificationPermission: 'granted' });

    expect(await screen.findByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Automation & alerts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable notifications' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Disable notifications on this device?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onDisablePush).not.toHaveBeenCalled();
  });

  it('opens the existing scanner scheduler from the single scheduling button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile();

    expect(await screen.findByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Automation & alerts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule scans' }));
    expect(props.onOpenScheduling).toHaveBeenCalledOnce();
  });

  it('shows every existing scheduled scan with a follow-up CTA', async () => {
    const fetchMock = vi.fn().mockImplementation((url) =>
      url === '/api/scheduled-scans'
        ? Promise.resolve({
            ok: true,
            json: async () => ({
              schedules: [
                {
                  id: 11,
                  scan_type: 'capitalFlow',
                  scan_time: '09:30',
                  scan_date: null,
                  active: 1,
                  last_run_at: null,
                },
                {
                  id: 12,
                  scan_type: 'maScanner',
                  scan_time: '14:15',
                  scan_date: '2026-08-27',
                  active: 0,
                  last_run_at: 1756200000,
                },
              ],
            }),
          })
        : Promise.resolve(summaryResponse())
    );
    vi.stubGlobal('fetch', fetchMock);
    const { props } = renderProfile();

    expect(await screen.findByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Automation & alerts' }));

    expect(await screen.findByText('09:30 · Every day')).toBeInTheDocument();
    expect(screen.getByText('MA Scanner')).toBeInTheDocument();
    expect(screen.getByText('Aug 27, 2026 · 14:15')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule another scan' }));
    expect(props.onOpenScheduling).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/scheduled-scans', expect.any(Object));
  });
});
