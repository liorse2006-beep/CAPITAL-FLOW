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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a floating button and no modal by default', () => {
    renderWithProviders(<FeedbackButton />);
    expect(screen.getByLabelText('Send feedback')).toBeInTheDocument();
    expect(screen.queryByText('Send Feedback')).not.toBeInTheDocument();
  });

  it('opens the modal on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('Send feedback'));
    expect(screen.getByText('Send Feedback')).toBeInTheDocument();
  });

  it('closes the modal on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('Send feedback'));
    expect(screen.getByText('Send Feedback')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Send Feedback')).not.toBeInTheDocument());
  });

  it('submits feedback to POST /api/feedback and shows a thank-you message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('Send feedback'));
    await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Great app!');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.getByText('Thanks!')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      '/api/feedback',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.message).toBe('Great app!');
  });

  it('the send button stays disabled until a message is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByLabelText('Send feedback'));
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("What's on your mind?"), 'hi');
    expect(screen.getByRole('button', { name: /^send$/i })).not.toBeDisabled();
  });
});
