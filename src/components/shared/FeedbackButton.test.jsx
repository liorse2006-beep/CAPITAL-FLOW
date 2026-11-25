import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FeedbackButton from './FeedbackButton';
import { AuthProvider } from '../../context/AuthContext';

function renderWithProviders(ui) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

describe('FeedbackButton', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a floating button and no modal by default', () => {
    renderWithProviders(<FeedbackButton />);
    expect(screen.getByLabelText('שליחת משוב')).toBeInTheDocument();
    expect(screen.queryByText('שליחת משוב')).not.toBeInTheDocument();
  });

  it('opens the modal on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('שליחת משוב'));
    expect(screen.getByText('שליחת משוב')).toBeInTheDocument();
  });

  it('closes the modal on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('שליחת משוב'));
    expect(screen.getByText('שליחת משוב')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('שליחת משוב')).not.toBeInTheDocument());
  });

  it('submits feedback to POST /api/feedback and shows a thank-you message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('שליחת משוב'));
    await user.type(screen.getByPlaceholderText('מה תרצה לשתף?'), 'Great app!');
    await user.click(screen.getByRole('button', { name: /שליחה/i }));

    await waitFor(() => expect(screen.getByText('תודה!')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/feedback', expect.objectContaining({ method: 'POST' }));
    // AuthProvider now fires its own /api/auth/refresh call on mount (the
    // silent-session-refresh flow), so the feedback POST is no longer
    // reliably the first fetch call — find it by URL instead of by index.
    const feedbackCall = fetch.mock.calls.find((call) => call[0] === '/api/feedback');
    const body = JSON.parse(feedbackCall[1].body);
    expect(body.message).toBe('Great app!');
  });

  it('the send button stays disabled until a message is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('שליחת משוב'));
    expect(screen.getByRole('button', { name: /שליחה/i })).toBeDisabled();
    await user.type(screen.getByPlaceholderText('מה תרצה לשתף?'), 'hi');
    expect(screen.getByRole('button', { name: /שליחה/i })).not.toBeDisabled();
  });
});
