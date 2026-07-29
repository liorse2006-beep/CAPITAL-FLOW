import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'

// App.jsx owns URL-driven page routing (page derived from location.pathname,
// setPage() navigates) — this was converted from plain state to
// react-router this session and has no coverage anywhere else. Rendered
// logged-out (no vs_token in localStorage) so AuthContext resolves
// synchronously with no network call, keeping these true unit-ish tests
// instead of a full integration suite.
function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>
  )
}

// jsdom doesn't implement matchMedia — useInstallPrompt (behind InstallPrompt,
// mounted unconditionally in App.jsx) reads it on mount to detect standalone
// PWA mode.
window.matchMedia =
  window.matchMedia ||
  function () {
    return { matches: false, addListener: () => {}, removeListener: () => {} }
  }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App routing', () => {
  it('renders the scanner page at the root path', () => {
    renderAt('/')
    expect(screen.getByText('Full Scan')).toBeInTheDocument()
  })

  it('renders the watchlist page at /watchlist', () => {
    renderAt('/watchlist')
    // WatchlistPage's empty state for a logged-out visitor
    expect(screen.getAllByText(/watchlist/i).length).toBeGreaterThan(0)
  })

  it('redirects an unknown path back to the scanner page', () => {
    renderAt('/this-route-does-not-exist')
    expect(screen.getByText('Full Scan')).toBeInTheDocument()
  })

  it('highlights the active tab in the topbar to match the current route', () => {
    const { container } = renderAt('/watchlist')
    const watchlistTab = container.querySelector('.nav-tabs .nav-tab:nth-child(4)')
    expect(watchlistTab.textContent).toMatch(/Watchlist/)
    expect(watchlistTab.className).toMatch(/active/)
  })
})
