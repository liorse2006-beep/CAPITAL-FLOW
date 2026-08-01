import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ChatWidget from './ChatWidget'

// Regression coverage for the bug where Capi's teaser stopped reappearing
// after being closed/dismissed once — the fix made "dismissed" apply only to
// the current closed stretch, not forever (see the comment above
// TEASER_READY_DELAY_MS in ChatWidget.jsx).

const USER = { id: 1, email: 'a@b.com' }

function historyFetchMock(rows = []) {
  return vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(rows) }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ChatWidget', () => {
  it('renders nothing when there is no logged-in user', () => {
    const { container } = render(<ChatWidget user={null} getToken={() => null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a logged-in user who is not Elite', () => {
    const { container } = render(<ChatWidget user={USER} isElite={false} getToken={() => 't'} />)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('does not show the teaser immediately on mount', () => {
    render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />)
    expect(screen.queryByText(/Hi, I.m Capi/)).not.toBeInTheDocument()
  })

  it('shows the teaser after the ready delay while the chat is closed', () => {
    render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument()
  })

  it('hides the teaser while the chat panel is open, and shows it again once closed', async () => {
    global.fetch = historyFetchMock([])
    const { container } = render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument()

    // The fab's own aria-label also becomes "Close chat" once open (same as
    // the panel header's close button), so target it by class to stay
    // unambiguous rather than by accessible name.
    fireEvent.click(container.querySelector('.chat-fab'))
    expect(screen.queryByText(/Hi, I.m Capi/)).not.toBeInTheDocument()

    fireEvent.click(container.querySelector('.chat-panel-close'))
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument()
  })

  it('dismissing the teaser hides it for the current closed stretch, but it reappears after an open/close cycle', async () => {
    global.fetch = historyFetchMock([])
    const { container } = render(<ChatWidget user={USER} isElite={true} getToken={() => 't'} />)
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Hi, I.m Capi/)).not.toBeInTheDocument()

    // Opening then closing the chat again is the one thing that should
    // bring it back — this is exactly the behavior the user reported as
    // broken ("the message doesn't come back even after a refresh").
    fireEvent.click(container.querySelector('.chat-fab'))
    fireEvent.click(container.querySelector('.chat-panel-close'))
    expect(screen.getByText(/Hi, I.m Capi/)).toBeInTheDocument()
  })
})
