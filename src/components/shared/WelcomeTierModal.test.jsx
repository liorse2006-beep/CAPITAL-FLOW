import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WelcomeTierModal from './WelcomeTierModal';
import { AuthProvider } from '../../context/AuthContext';

function renderWithProviders(ui) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

async function advanceToReadyState() {
  await act(async () => {
    vi.advanceTimersByTime(1200);
  });
}

describe('WelcomeTierModal', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('shows a compact Premium confirmation with one clear next step', async () => {
    vi.useFakeTimers();
    const { container } = renderWithProviders(<WelcomeTierModal tier="premium" confirmed onClose={vi.fn()} />);

    expect(screen.getByText('התשלום התקבל')).toBeInTheDocument();
    expect(screen.getByText('מפעילים את הגישה')).toBeInTheDocument();
    await advanceToReadyState();
    expect(screen.getByText('הגישה מוכנה')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תודה על הרכישה' })).toBeInTheDocument();
    expect(screen.getByText('מסלול Premium שלך פעיל. אפשר להתחיל לסרוק.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'התחלת סריקה' })).toBeInTheDocument();
    expect(screen.getByText('אפשר גם לסגור את ההודעה ולהמשיך.')).toBeInTheDocument();
    expect(container.querySelector('.welcome-tier-features')).toBeNull();
    expect(screen.queryByRole('button', { name: /שדרוג ל־Elite/i })).not.toBeInTheDocument();
  });

  it('shows the same minimal confirmation for Elite', async () => {
    vi.useFakeTimers();
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed onClose={vi.fn()} />);

    expect(screen.getByText('התשלום התקבל')).toBeInTheDocument();
    await advanceToReadyState();
    expect(screen.getByText('ELITE')).toBeInTheDocument();
    expect(screen.getByText('מסלול Elite שלך פעיל. אפשר להתחיל לסרוק.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'התחלת סריקה' })).toBeInTheDocument();
  });

  it('shows the activation screen briefly even when access is confirmed immediately', async () => {
    vi.useFakeTimers();
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed onClose={vi.fn()} />);

    expect(screen.getByText('התשלום התקבל')).toBeInTheDocument();
    expect(screen.getByText('מפעילים את הגישה')).toBeInTheDocument();
    expect(screen.queryByText('הגישה מוכנה')).not.toBeInTheDocument();

    await advanceToReadyState();

    expect(screen.getByText('הגישה מוכנה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'התחלת סריקה' })).toBeInTheDocument();
  });

  it('opens immediately in a waiting state while the webhook activates access', () => {
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed={false} onClose={vi.fn()} />);

    expect(screen.getByText('התשלום התקבל')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תודה על הרכישה' })).toBeInTheDocument();
    expect(screen.getByText('מפעילים את מסלול Elite שלך. זה בדרך כלל לוקח כמה שניות.')).toBeInTheDocument();
    expect(screen.getByText('מאמתים את התשלום ומכינים את סביבת העבודה שלך.')).toBeInTheDocument();
    expect(screen.getByText('מפעילים את הגישה')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'התחלת סריקה' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeInTheDocument();
  });

  it('reveals Start scanning when the server confirms the paid tier', async () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(<WelcomeTierModal tier="elite" confirmed={false} onClose={vi.fn()} />);

    rerender(
      <MemoryRouter>
        <AuthProvider>
          <WelcomeTierModal tier="elite" confirmed onClose={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('מפעילים את הגישה')).toBeInTheDocument();
    await advanceToReadyState();
    expect(screen.queryByText('מפעילים את הגישה')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'התחלת סריקה' })).toBeInTheDocument();
  });

  it('closes from Start scanning, the X, and Escape', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = renderWithProviders(<WelcomeTierModal tier="elite" confirmed onClose={onClose} />);

    await advanceToReadyState();
    fireEvent.click(screen.getByRole('button', { name: 'התחלת סריקה' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<WelcomeTierModal tier="elite" confirmed onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<WelcomeTierModal tier="elite" confirmed onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
