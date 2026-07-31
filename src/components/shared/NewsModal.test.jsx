import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import NewsModal, { prefetchNews } from './NewsModal'

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NewsModal', () => {
  it('shows the loading state, then renders articles once the fetch resolves', async () => {
    global.fetch = vi.fn(() =>
      jsonResponse({ articles: [{ headline: 'Big News', source: 'Reuters', sentiment: 'positive', datetime: 0 }] })
    )
    render(<NewsModal symbol="LOAD1" onClose={vi.fn()} getToken={() => 't'} onRequireUpgrade={vi.fn()} />)

    expect(screen.getByText('LOAD1')).toBeInTheDocument() // news-loading-symbol

    await waitFor(() => expect(screen.getByText('Big News')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state when no articles are returned', async () => {
    global.fetch = vi.fn(() => jsonResponse({ articles: [] }))
    render(<NewsModal symbol="EMPTY1" onClose={vi.fn()} getToken={() => 't'} onRequireUpgrade={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No Recent Coverage')).toBeInTheDocument())
  })

  it('shows the error state and lets the user retry when the fetch fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    render(<NewsModal symbol="ERR1" onClose={vi.fn()} getToken={() => 't'} onRequireUpgrade={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Unable to Reach News Sources')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
  })

  it('closes and requests an upgrade on a 403, without rendering an error state', async () => {
    global.fetch = vi.fn(() => jsonResponse({}, 403))
    const onClose = vi.fn()
    const onRequireUpgrade = vi.fn()
    render(<NewsModal symbol="FORBID1" onClose={onClose} getToken={() => 't'} onRequireUpgrade={onRequireUpgrade} />)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onRequireUpgrade).toHaveBeenCalled()
  })

  it('prefetchNews warms the cache so the modal later opens with zero fetches', async () => {
    global.fetch = vi.fn(() =>
      jsonResponse({ articles: [{ headline: 'Prefetched Headline', source: 'WSJ', datetime: 0 }] })
    )
    prefetchNews('PREF1', () => 't')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    render(<NewsModal symbol="PREF1" onClose={vi.fn()} getToken={() => 't'} onRequireUpgrade={vi.fn()} />)
    expect(screen.getByText('Prefetched Headline')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)

    // A second prefetch within the TTL is a no-op
    prefetchNews('PREF1', () => 't')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses the client-side cache on a re-mount for the same symbol, without re-fetching', async () => {
    global.fetch = vi.fn(() =>
      jsonResponse({ articles: [{ headline: 'Cached Headline', source: 'Bloomberg', datetime: 0 }] })
    )
    const symbol = 'CACHE1'
    const { unmount } = render(
      <NewsModal symbol={symbol} onClose={vi.fn()} getToken={() => 't'} onRequireUpgrade={vi.fn()} />
    )
    await waitFor(() => expect(screen.getByText('Cached Headline')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledTimes(1)
    unmount()

    // Simulates closing and reopening News for the same ticker (NewsModal
    // fully unmounts on close in App.jsx) — this used to replay the whole
    // loading animation and re-hit the network every time.
    render(<NewsModal symbol={symbol} onClose={vi.fn()} getToken={() => 't'} onRequireUpgrade={vi.fn()} />)
    expect(screen.getByText('Cached Headline')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
