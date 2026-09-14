import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('WelcomeTierModal', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows a compact Premium confirmation with one clear next step', () => {
    const { container } = renderWithProviders(<WelcomeTierModal tier="premium" confirmed onClose={vi.fn()} />);

    expect(screen.getByText('ACCESS READY')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thank you for your purchase' })).toBeInTheDocument();
    expect(screen.getByText('Your Premium access is active. You can start scanning now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'START SCANNING' })).toBeInTheDocument();
    expect(screen.getByText('Or close this message with × to continue.')).toBeInTheDocument();
    expect(container.querySelector('.welcome-tier-features')).toBeNull();
    expect(screen.queryByRole('button', { name: /upgrade to elite/i })).not.toBeInTheDocument();
  });

  it('shows the same minimal confirmation for Elite', () => {
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed onClose={vi.fn()} />);

    expect(screen.getByText('ELITE')).toBeInTheDocument();
    expect(screen.getByText('Your Elite access is active. You can start scanning now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'START SCANNING' })).toBeInTheDocument();
  });

  it('opens immediately in a waiting state while the webhook activates access', () => {
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed={false} onClose={vi.fn()} />);

    expect(screen.getByText('PAYMENT RECEIVED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thank you for your purchase' })).toBeInTheDocument();
    expect(
      screen.getByText('Your Elite access is being prepared. This usually takes a few seconds.')
    ).toBeInTheDocument();
    expect(screen.getByText("We're activating your access securely.")).toBeInTheDocument();
    expect(screen.getByText('ACTIVATING ACCESS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'START SCANNING' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('reveals Start scanning when the server confirms the paid tier', () => {
    const { rerender } = renderWithProviders(<WelcomeTierModal tier="elite" confirmed={false} onClose={vi.fn()} />);

    rerender(
      <MemoryRouter>
        <AuthProvider>
          <WelcomeTierModal tier="elite" confirmed onClose={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.queryByText('ACTIVATING ACCESS')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'START SCANNING' })).toBeInTheDocument();
  });

  it('closes from Start scanning, the X, and Escape', () => {
    const onClose = vi.fn();
    const { rerender } = renderWithProviders(<WelcomeTierModal tier="elite" confirmed onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'START SCANNING' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<WelcomeTierModal tier="elite" confirmed onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<WelcomeTierModal tier="elite" confirmed onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
