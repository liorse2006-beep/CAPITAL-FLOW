import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  it('does not restore a session after token rotation even if the old screen remains mounted', async () => {
    let resolvePassword;
    let token = 'synthetic-old-token';
    const request = new Promise((resolve) => {
      resolvePassword = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => (url === '/api/account/change-password' ? request : Promise.resolve(summaryResponse())))
    );
    const { props } = renderProfile({ initialSection: 'security', getToken: () => token });
    await screen.findByLabelText('סיסמה נוכחית');
    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'synthetic-old-password' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'synthetic-new-password' } });
    fireEvent.change(screen.getByLabelText('אימות הסיסמה החדשה'), { target: { value: 'synthetic-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' }));
    token = 'synthetic-other-token';
    await act(async () =>
      resolvePassword({ ok: true, json: async () => ({ token: 'synthetic-replacement-session', user }) })
    );
    expect(props.onPasswordChanged).not.toHaveBeenCalled();
  });

  it('accepts a successful password update only for the current account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        Promise.resolve(
          url === '/api/account/change-password'
            ? { ok: true, json: async () => ({ token: 'synthetic-new-session', user }) }
            : summaryResponse()
        )
      )
    );
    const { props } = renderProfile({ initialSection: 'security' });
    await screen.findByLabelText('סיסמה נוכחית');
    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'synthetic-old-password' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'synthetic-new-password' } });
    fireEvent.change(screen.getByLabelText('אימות הסיסמה החדשה'), { target: { value: 'synthetic-new-password' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' })));
    expect(props.onPasswordChanged).toHaveBeenCalledWith('synthetic-new-session', user);
    expect(screen.getByText('הסיסמה עודכנה. שאר המכשירים נותקו מהחשבון.')).toBeInTheDocument();
  });

  it('does not restore an old account session from a password response after unmount', async () => {
    let resolvePassword;
    const pendingPassword = new Promise((resolve) => {
      resolvePassword = resolve;
    });
    const fetchMock = vi.fn((url) =>
      url === '/api/account/change-password' ? pendingPassword : Promise.resolve(summaryResponse())
    );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount, props } = renderProfile({ initialSection: 'security' });
    await screen.findByLabelText('סיסמה נוכחית');
    fireEvent.change(screen.getByLabelText('סיסמה נוכחית'), { target: { value: 'synthetic-old-password' } });
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'synthetic-new-password' } });
    fireEvent.change(screen.getByLabelText('אימות הסיסמה החדשה'), { target: { value: 'synthetic-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'עדכון סיסמה' }));
    unmount();
    await act(async () => resolvePassword({ ok: true, json: async () => ({ token: 'synthetic-new-session', user }) }));
    expect(props.onPasswordChanged).not.toHaveBeenCalled();
    const options = fetchMock.mock.calls.find(([url]) => url === '/api/account/change-password')[1];
    expect(options.signal.aborted).toBe(true);
  });

  it('does not download the previous account export after unmount', async () => {
    let resolveExport;
    const pendingExport = new Promise((resolve) => {
      resolveExport = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => (url === '/api/account/export' ? pendingExport : Promise.resolve(summaryResponse())))
    );
    const createObjectURL = vi.fn(() => 'blob:synthetic-export');
    const original = URL.createObjectURL;
    URL.createObjectURL = createObjectURL;
    try {
      const { unmount } = renderProfile({ initialSection: 'security' });
      await screen.findByRole('button', { name: 'הורדת הנתונים שלי' });
      fireEvent.click(screen.getByRole('button', { name: 'הורדת הנתונים שלי' }));
      unmount();
      await act(async () => resolveExport({ ok: true, blob: async () => new Blob(['synthetic-account-export']) }));
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = original;
    }
  });

  it('uses the close control without rendering a redundant Done action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    renderProfile();

    expect(await screen.findByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'סגירת פרטי החשבון' })).toBeInTheDocument();
  });

  it('asks for confirmation before enabling notifications', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile();

    expect(await screen.findByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תזמונים והתראות' }));
    fireEvent.click(screen.getByRole('button', { name: 'הפעלת התראות' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('הפעלת התראות במכשיר הזה?');
    expect(props.onEnablePush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'אישור' }));
    expect(props.onEnablePush).toHaveBeenCalledOnce();
  });

  it('asks for confirmation before disabling notifications', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile({ pushEnabled: true, notificationPermission: 'granted' });

    expect(await screen.findByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תזמונים והתראות' }));
    fireEvent.click(screen.getByRole('button', { name: 'כיבוי התראות' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('כיבוי התראות במכשיר הזה?');
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(props.onDisablePush).not.toHaveBeenCalled();
  });

  it('opens the existing scanner scheduler from the single scheduling button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    const { props } = renderProfile();

    expect(await screen.findByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תזמונים והתראות' }));
    fireEvent.click(await screen.findByRole('button', { name: 'תזמון סריקות' }));
    expect(props.onOpenScheduling).toHaveBeenCalledOnce();
  });

  it('places notifications above scan scheduling in Automation & alerts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse()));
    renderProfile();

    expect(await screen.findByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תזמונים והתראות' }));

    const notifications = await screen.findByRole('heading', { name: 'התראות' });
    const scheduling = screen.getByRole('heading', { name: 'תזמון סריקות' });
    expect(notifications.compareDocumentPosition(scheduling) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    expect(await screen.findByRole('heading', { name: 'מרכז החשבון' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תזמונים והתראות' }));

    expect(await screen.findByText('09:30 · כל יום')).toBeInTheDocument();
    expect(screen.getByText('סורק ממוצעים נעים')).toBeInTheDocument();
    const date = new Date('2026-08-27T00:00:00Z').toLocaleDateString('he-IL', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    expect(screen.getByText(date + ' · 14:15')).toBeInTheDocument();
    expect(screen.getByText('פעיל')).toBeInTheDocument();
    expect(screen.getByText('מושהה')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תזמון סריקה נוספת' }));
    expect(props.onOpenScheduling).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/scheduled-scans', expect.any(Object));
  });
});
