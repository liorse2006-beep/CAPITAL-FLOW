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

    expect(screen.getByRole('dialog', { name: /תקופת הניסיון הסתיימה/ })).toBeInTheDocument();
    expect(screen.getByText(/ממשיכים גם אחרי הניסיון\./i)).toBeInTheDocument();
    expect(screen.getByText(/תשלום חד־פעמי · גישה ללא הגבלת זמן/i)).toBeInTheDocument();
    expect(screen.getByText(/בלי חיוב חודשי\. ההגדרות שלך נשמרות\./i)).toBeInTheDocument();
    expect(screen.queryByText(/5 סריקות ב־24 שעות, במכסה משותפת/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unlimited scans, alerts, push/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /למסלולים ולהמשך סריקה/i }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });
});
