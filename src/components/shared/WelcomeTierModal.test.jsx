import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import WelcomeTierModal from './WelcomeTierModal'
import { AuthProvider } from '../../context/AuthContext'

// See UpgradeModal.test.jsx — the real embed mounts an iframe against
// Whop's servers, not something jsdom can/should exercise.
vi.mock('@whop/checkout/react', () => ({
  WhopCheckoutEmbed: (props) => (
    <div data-testid="whop-checkout-embed" data-session-id={props.sessionId}>
      <button onClick={() => props.onComplete('plan_x', 'receipt_x', {})}>Simulate payment complete</button>
    </div>
  ),
  WhopExpressCheckoutButton: (props) => {
    if (props.onExpressMethodResolved) props.onExpressMethodResolved({ rendered: 'none' })
    return <div data-testid="whop-express-button" data-plan-id={props.planId} />
  },
}))

function renderWithProviders(ui) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  )
}

describe('WelcomeTierModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows the Premium badge/headline, checks off what Premium includes, and groups the Elite-only items separately', () => {
    const { container } = renderWithProviders(<WelcomeTierModal tier="premium" confirmed={true} onClose={vi.fn()} />)
    expect(screen.getByText('PREMIUM')).toBeInTheDocument()
    expect(screen.getByText('Welcome to Premium')).toBeInTheDocument()

    // Universal features (available to Free too) aren't part of the paid checklist at all
    expect(screen.queryByText('AI-summarized news')).not.toBeInTheDocument()

    const included = [...container.querySelectorAll('.welcome-tier-features:not(.welcome-tier-features-excluded) li')].map(
      (li) => li.textContent
    )
    const excluded = [...container.querySelectorAll('.welcome-tier-features-excluded li')].map((li) => li.textContent)
    expect(included).toEqual(['Advanced filters & presets', 'Float & short interest data', 'Ticker notes & charts'])
    expect(excluded).toEqual([
      'Capi — your AI market mentor',
      'Push notifications',
      'Daily scheduled scan',
      'Custom watchlist alerts',
    ])
    expect(screen.getByText('Also included with Elite')).toBeInTheDocument()
  })

  it('shows the Elite badge/headline with every paid feature checked off, and no excluded section at all', () => {
    const { container } = renderWithProviders(<WelcomeTierModal tier="elite" confirmed={true} onClose={vi.fn()} />)
    expect(screen.getByText('ELITE')).toBeInTheDocument()
    expect(screen.getByText('Welcome to Elite')).toBeInTheDocument()
    expect(screen.getByText('Capi — your AI market mentor')).toBeInTheDocument()
    expect(screen.getByText('Push notifications')).toBeInTheDocument()
    expect(container.querySelector('.welcome-tier-features-excluded')).toBeNull()
    expect(screen.queryByText('Also included with Elite')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.welcome-tier-features li').length).toBe(7)
  })

  it('shows a "confirming" indicator when not yet confirmed, and hides it once confirmed', () => {
    const { rerender } = renderWithProviders(<WelcomeTierModal tier="elite" confirmed={false} onClose={vi.fn()} />)
    expect(screen.getByText(/Confirming with Whop/)).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <AuthProvider>
          <WelcomeTierModal tier="elite" confirmed={true} onClose={vi.fn()} />
        </AuthProvider>
      </MemoryRouter>
    )
    expect(screen.queryByText(/Confirming with Whop/)).not.toBeInTheDocument()
  })

  it('does not show the confirming indicator when already confirmed on mount', () => {
    renderWithProviders(<WelcomeTierModal tier="premium" confirmed={true} onClose={vi.fn()} />)
    expect(screen.queryByText(/Confirming with Whop/)).not.toBeInTheDocument()
  })

  it('calls onClose from the CTA button and the close button', () => {
    const onClose = vi.fn()
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start scanning' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  // ── The one-time Elite upgrade offer (Premium screen only) ──

  it('shows the half-price Elite upgrade offer only on the Premium screen, never on Elite', () => {
    renderWithProviders(<WelcomeTierModal tier="premium" confirmed={true} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /upgrade to elite — 50% off/i })).toBeInTheDocument()
    expect(screen.getByText(/\$14\.95/)).toBeInTheDocument()
  })

  it('does not show the upgrade offer on the Elite welcome screen', () => {
    renderWithProviders(<WelcomeTierModal tier="elite" confirmed={true} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /upgrade to elite/i })).not.toBeInTheDocument()
  })

  it('demotes "Start scanning" to a quiet secondary action when the upgrade offer is showing', () => {
    const { container } = renderWithProviders(<WelcomeTierModal tier="premium" confirmed={true} onClose={vi.fn()} />)
    const startScanning = screen.getByRole('button', { name: 'Start scanning' })
    expect(startScanning.className).toMatch(/welcome-tier-cta-secondary/)
    // Elite has no offer, so its own CTA must stay the normal, featured button
    expect(container.querySelector('.welcome-tier-cta-secondary')).toBeInTheDocument()
  })

  it('clicking the upgrade offer starts checkout, stashes the pending tier, and mounts the embed inline', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: 'ch_upgrade_test', planId: 'plan_elite_upgrade' }),
      })
    )
    renderWithProviders(<WelcomeTierModal tier="premium" confirmed={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /upgrade to elite — 50% off/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/checkout/transaction',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tier: 'eliteUpgrade' }) })
      )
    )
    await waitFor(() => expect(localStorage.getItem('vs_pending_tier')).toBe('elite'))
    const embed = await screen.findByTestId('whop-checkout-embed')
    expect(embed).toHaveAttribute('data-session-id', 'ch_upgrade_test')
  })

  it('shows an error message if starting the upgrade checkout fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'This offer is only available to Premium accounts' }) })
    )
    renderWithProviders(<WelcomeTierModal tier="premium" confirmed={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /upgrade to elite — 50% off/i }))

    await waitFor(() => expect(screen.getByText('This offer is only available to Premium accounts')).toBeInTheDocument())
  })
})
