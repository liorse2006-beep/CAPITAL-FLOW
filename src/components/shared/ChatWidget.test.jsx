import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import ChatWidget from './ChatWidget';

// Regression coverage for the bug where Capi's teaser stopped reappearing
// after being closed/dismissed once — the fix made "dismissed" apply only to
// the current closed stretch, not forever (see the comment above
// TEASER_READY_DELAY_MS in ChatWidget.jsx).

const USER = { id: 1, email: 'a@b.com' };
const ORIGINAL_FETCH = globalThis.fetch;

function historyFetchMock(rows = []) {
  return vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(rows) }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatWidget', () => {
  it('a guest still sees the launcher, and tapping it asks them to sign in instead of opening chat', () => {
    const onRequireAuth = vi.fn();
    const { container } = render(<ChatWidget user={null} getToken={() => null} onRequireAuth={onRequireAuth} />);
    expect(container.querySelector('.chat-fab')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.chat-fab'));
    expect(onRequireAuth).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.chat-panel')).not.toBeInTheDocument();
  });

  it('shows the guest the same teaser message a signed-in Elite user gets', () => {
    render(<ChatWidget user={null} getToken={() => null} onRequireAuth={() => {}} />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument();
  });

  it('renders nothing for a logged-in Premium user who is not Elite', () => {
    const { container } = render(
      <ChatWidget user={{ ...USER, tier: 'premium' }} isElite={false} trialEnded={false} getToken={() => 't'} />
    );
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps Capi visible after a free trial ends and opens the trial message on tap', () => {
    const onTrialEnded = vi.fn();
    const { container } = render(
      <ChatWidget
        user={{ ...USER, tier: 'free' }}
        isElite={false}
        trialEnded
        getToken={() => 't'}
        onTrialEnded={onTrialEnded}
      />
    );

    expect(container.querySelector('.chat-fab')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.chat-fab'));
    expect(onTrialEnded).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.chat-panel')).not.toBeInTheDocument();
  });

  it('does not show the teaser immediately on mount', () => {
    render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />);
    expect(screen.queryByText(/Hi, I.m Capi/)).not.toBeInTheDocument();
  });

  it('shows the teaser after the ready delay while the chat is closed', () => {
    render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument();
  });

  it('hides the teaser while the chat panel is open, and shows it again once closed', async () => {
    globalThis.fetch = historyFetchMock([]);
    const { container } = render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument();

    // The fab's own aria-label also becomes "Close chat" once open (same as
    // the panel header's close button), so target it by class to stay
    // unambiguous rather than by accessible name.
    fireEvent.click(container.querySelector('.chat-fab'));
    expect(screen.queryByText(/Hi, I.m Capi/)).not.toBeInTheDocument();

    fireEvent.click(container.querySelector('.chat-panel-close'));
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument();
  });

  it('dismissing the teaser hides it for the current closed stretch, but it reappears after an open/close cycle', async () => {
    globalThis.fetch = historyFetchMock([]);
    const { container } = render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Hi, I.m Capi/)).not.toBeInTheDocument();

    // Opening then closing the chat again is the one thing that should
    // bring it back — this is exactly the behavior the user reported as
    // broken ("the message doesn't come back even after a refresh").
    fireEvent.click(container.querySelector('.chat-fab'));
    fireEvent.click(container.querySelector('.chat-panel-close'));
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument();
  });

  it('renders nothing on mobile so the Capi launcher cannot appear there', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    try {
      const { container } = render(<ChatWidget user={USER} isElite getToken={() => 't'} />);
      expect(container).toBeEmptyDOMElement();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('renders streamed Capi text into one assistant bubble and uses the canonical completion', async () => {
    vi.useRealTimers();
    const encoder = new TextEncoder();
    const streamBody = [
      'event: ready\ndata: {"status":"connected"}\n\n',
      'event: delta\ndata: {"text":"First "}\n\n',
      'event: delta\ndata: {"text":"second."}\n\n',
      'event: complete\ndata: {"reply":"First second."}\n\n',
    ].join('');
    globalThis.fetch = vi.fn((url) => {
      if (url === '/api/chat/history') return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url === '/api/chat/message/stream') {
        return Promise.resolve({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              const split = streamBody.indexOf('event: delta');
              controller.enqueue(encoder.encode(streamBody.slice(0, split)));
              setTimeout(() => {
                controller.enqueue(encoder.encode(streamBody.slice(split)));
                controller.close();
              }, 0);
            },
          }),
        });
      }
      return Promise.reject(new Error('unexpected request: ' + url));
    });

    const { container } = render(<ChatWidget user={USER} isElite getToken={() => 't'} />);
    fireEvent.click(container.querySelector('.chat-fab'));
    const input = await screen.findByPlaceholderText('Message Capi…');
    fireEvent.change(input, { target: { value: 'Explain unusual volume.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('First second.')).toBeInTheDocument());
    expect(screen.getAllByText('First second.')).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/chat/message/stream',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'Explain unusual volume.' }) })
    );
  });

  it('keeps a streamed optimistic answer when the slower history prefetch finishes later', async () => {
    vi.useRealTimers();
    let resolveHistory;
    const historyPromise = new Promise((resolve) => {
      resolveHistory = resolve;
    });
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn((url) => {
      if (url === '/api/chat/history') return historyPromise;
      if (url === '/api/chat/message/stream') {
        const body =
          'event: ready\ndata: {"status":"connected"}\n\n' +
          'event: delta\ndata: {"text":"Streamed answer"}\n\n' +
          'event: complete\ndata: {"reply":"Streamed answer"}\n\n';
        return Promise.resolve({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(body));
              controller.close();
            },
          }),
        });
      }
      return Promise.reject(new Error('unexpected request: ' + url));
    });

    const { container } = render(<ChatWidget user={USER} isElite getToken={() => 't'} />);
    fireEvent.click(container.querySelector('.chat-fab'));
    const input = await screen.findByPlaceholderText('Message Capi…');
    fireEvent.change(input, { target: { value: 'Keep this answer.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Streamed answer')).toBeInTheDocument());

    resolveHistory({ ok: true, json: () => Promise.resolve([{ id: 10, role: 'user', content: 'Older turn' }]) });
    await waitFor(() => expect(screen.getByText('Older turn')).toBeInTheDocument());
    expect(screen.getByText('Streamed answer')).toBeInTheDocument();
    expect(screen.getByText('Keep this answer.')).toBeInTheDocument();
  });

  it('clears the previous account conversation when the signed-in account changes', async () => {
    vi.useRealTimers();
    let rows = [{ id: 11, role: 'user', content: 'Private first-account turn' }];
    globalThis.fetch = vi.fn((url) => {
      if (url === '/api/chat/history') return Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });
      return Promise.reject(new Error('unexpected request: ' + url));
    });

    const { container, rerender } = render(<ChatWidget user={USER} isElite getToken={() => 'first-token'} />);
    fireEvent.click(container.querySelector('.chat-fab'));
    expect(await screen.findByText('Private first-account turn')).toBeInTheDocument();

    rows = [];
    rerender(<ChatWidget user={{ id: 2, email: 'second@example.com' }} isElite getToken={() => 'second-token'} />);
    await waitFor(() => expect(screen.queryByText('Private first-account turn')).not.toBeInTheDocument());
  });
});
