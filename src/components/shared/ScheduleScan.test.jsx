import { render, screen, waitFor } from '@testing-library/react';
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

  it('saves a schedule on a browser without push support', async () => {
    const user = userEvent.setup();
    renderScheduler();

    await user.click(screen.getByRole('button', { name: 'Schedule automatic scan' }));
    expect(screen.getByRole('status')).toHaveTextContent(/schedule will still run/i);

    await user.click(screen.getByRole('button', { name: '+ Add' }));

    await waitFor(() =>
      expect(mocks.addSchedule).toHaveBeenCalledWith('09:30', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    );
  });

  it('keeps scheduling available when push is supported but not enabled', async () => {
    const user = userEvent.setup();
    renderScheduler({ pushSupported: true });

    await user.click(screen.getByRole('button', { name: 'Schedule automatic scan' }));
    expect(screen.getByRole('status')).toHaveTextContent(/push alerts are currently off/i);
    await user.click(screen.getByRole('button', { name: '+ Add' }));

    await waitFor(() => expect(mocks.addSchedule).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Enable push notifications' })).toBeInTheDocument();
  });
});
