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
    expect(screen.getByRole('dialog', { name: 'Schedule scan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule automatic scan' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Schedule scan' })).not.toBeInTheDocument();
  });

  it('saves a schedule on a browser without push support', async () => {
    const user = userEvent.setup();
    renderScheduler();

    await user.click(screen.getByRole('button', { name: 'Schedule automatic scan' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.getByRole('dialog', { name: "Notifications aren't enabled" })).toBeInTheDocument();
    expect(screen.getByText(/add Capital Flow to your Home Screen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue without push' }));

    await waitFor(() =>
      expect(mocks.addSchedule).toHaveBeenCalledWith('09:30', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    );
  });

  it('keeps scheduling available when push is supported but not enabled', async () => {
    const user = userEvent.setup();
    const onEnablePush = vi.fn().mockResolvedValue(undefined);
    renderScheduler({ pushSupported: true, onEnablePush });

    await user.click(screen.getByRole('button', { name: 'Schedule automatic scan' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.getByRole('dialog', { name: "Notifications aren't enabled" })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enable notifications' }));

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
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.click(screen.getByRole('button', { name: 'Continue without push' }));

    const choice = within(screen.getByRole('dialog', { name: "Notifications aren't enabled" }));
    await waitFor(() =>
      expect(choice.getByRole('alert')).toHaveTextContent("We couldn't save your schedule. Please try again.")
    );
    expect(choice.getByRole('button', { name: 'Continue without push' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'Schedule scan' })).toBeInTheDocument();
  });
});
