import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '../../context/AuthContext'
import FundamentalsPage from './FundamentalsPage'

// Rendered logged-out (no vs_token in localStorage), same reasoning as
// App.test.jsx: AuthContext resolves synchronously with no network call.
function renderPage(props = {}) {
  return render(
    <AuthProvider>
      <FundamentalsPage onUpgrade={vi.fn()} onSignIn={vi.fn()} {...props} />
    </AuthProvider>
  )
}

describe('FundamentalsPage', () => {
  it('gates the lookup behind sign-in for a logged-out visitor, never showing the search UI', () => {
    renderPage()
    expect(screen.getByText(/Premium\/Elite feature/)).toBeInTheDocument()
    expect(screen.queryByText('Analyze')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Enter a ticker/)).not.toBeInTheDocument()
  })

  it('the sign-in prompt calls onSignIn, not onUpgrade, for a logged-out visitor', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()
    const onUpgrade = vi.fn()
    renderPage({ onSignIn, onUpgrade })
    await user.click(screen.getByText('Sign In'))
    expect(onSignIn).toHaveBeenCalled()
    expect(onUpgrade).not.toHaveBeenCalled()
  })
})
