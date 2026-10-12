import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrialEndedModal from './TrialEndedModal';

describe('TrialEndedModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('explains the value of the trial and opens the plan selector without pre-showing plans', async () => {
    const user = userEvent.setup();
    const onUpgrade = vi.fn();

    render(<TrialEndedModal onClose={vi.fn()} onUpgrade={onUpgrade} />);

    expect(screen.getByRole('dialog', { name: /Trial ended/ })).toBeInTheDocument();
    expect(screen.getByText(/Keep your edge after day seven\./i)).toBeInTheDocument();
    expect(screen.getByText(/One-time purchase · Lifetime access/i)).toBeInTheDocument();
    expect(screen.getByText(/pay once. no recurring billing/i)).toBeInTheDocument();
    expect(screen.queryByText(/5 scans \/ 24h/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unlimited scans, alerts, push/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /See plans and keep scanning/i }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });
});
