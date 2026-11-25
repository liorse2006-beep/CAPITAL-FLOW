import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleScan from './ScheduleScan';

const mocks = vi.hoisted(() => ({
  addSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  removeSchedule: vi.fn(),
  mySchedules: [],
  loading: false,
  error: null,
}));

vi.mock('../../hooks/useScheduledScans', () => ({
  default: () => ({
    mySchedules: mocks.mySchedules,
    loading: mocks.loading,
    error: mocks.error,
    addSchedule: mocks.addSchedule,
    toggleSchedule: mocks.toggleSchedule,
    removeSchedule: mocks.removeSchedule,
  }),
}));

function renderScheduler(pushProps = {}) {
  return render(
    <ScheduleScan
      scanType="capitalFlow"
      user={{ id: 1, tier: 'elite' }}
      onUpgrade={vi.fn()}
      onSignIn={vi.fn()}
      pushSupported={false}
      pushEnabled={false}
      pushBusy={false}
      pushError={null}
      onEnablePush={vi.fn()}
      {...pushProps}
    />
  );
}

describe('ScheduleScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mySchedules = [];
    mocks.loading = false;
    mocks.error = null;
    mocks.addSchedule.mockResolvedValue(undefined);
  });

  it('opens the existing dialog immediately for the profile without a second trigger', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderScheduler({ initiallyOpen: true, hideTrigger: true, onClose });
    expect(screen.getByRole('dialog', { name: 'תזמון סריקה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule automatic scan' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'תזמון סריקה' })).not.toBeInTheDocument();
  });

  it('saves a schedule on a browser without push support', async () => {
    const user = userEvent.setup();
    renderScheduler();

    await user.click(screen.getByRole('button', { name: 'תזמון סריקה אוטומטית' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ הוספה' }));
    expect(screen.getByRole('dialog', { name: 'ההתראות אינן מופעלות' })).toBeInTheDocument();
    expect(screen.getByText(/באייפון: שיתוף ← הוספה למסך הבית/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'המשך בלי התראות למכשיר' }));

    await waitFor(() =>
      expect(mocks.addSchedule).toHaveBeenCalledWith('09:30', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    );
  });

  it('keeps scheduling available when push is supported but not enabled', async () => {
    const user = userEvent.setup();
    const onEnablePush = vi.fn().mockResolvedValue(undefined);
    renderScheduler({ pushSupported: true, onEnablePush });

    await user.click(screen.getByRole('button', { name: 'תזמון סריקה אוטומטית' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ הוספה' }));
    expect(screen.getByRole('dialog', { name: 'ההתראות אינן מופעלות' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הפעלת התראות' }));

    await waitFor(() => expect(mocks.addSchedule).toHaveBeenCalledTimes(1));
    expect(onEnablePush).toHaveBeenCalledTimes(1);
  });

  it('shows a failed save inside the active notification-choice dialog and keeps retry available', async () => {
    const user = userEvent.setup();
    mocks.addSchedule.mockImplementation(async () => {
      mocks.error = 'Failed to create schedule';
      return false;
    });
    renderScheduler({ initiallyOpen: true });
    await user.click(screen.getByRole('button', { name: '+ הוספה' }));
    await user.click(screen.getByRole('button', { name: 'המשך בלי התראות למכשיר' }));

    const choice = within(screen.getByRole('dialog', { name: 'ההתראות אינן מופעלות' }));
    await waitFor(() =>
      expect(choice.getByRole('alert')).toHaveTextContent('לא הצלחנו לשמור את התזמון. אפשר לנסות שוב.')
    );
    expect(choice.getByRole('button', { name: 'המשך בלי התראות למכשיר' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'תזמון סריקה' })).toBeInTheDocument();
  });
});
