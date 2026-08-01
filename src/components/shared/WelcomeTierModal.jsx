import React, { useEffect, useState } from 'react'
import useModalA11y from '../../hooks/useModalA11y'
import { tierFeatureChecklist } from '../../constants/tierFeatures'
import { useAuth } from '../../context/AuthContext'

// How long the "confirming with Whop" indicator stays up before we quietly
// stop showing it — the badge/copy already reflect the tier the user just
// bought regardless, so an indicator that never resolves would just look
// broken instead of adding real information past this point.
var CONFIRM_TIMEOUT_MS = 12000

var COPY = {
  premium: {
    label: 'PREMIUM',
    badgeClass: 'tier-premium',
    headline: 'Welcome to Premium',
    body:
      "Thanks for backing what we're building — we don't take that lightly. Every tool below is live on your account right now.",
  },
  elite: {
    label: 'ELITE',
    badgeClass: 'tier-elite',
    headline: 'Welcome to Elite',
    body:
      "Thank you for going all in with us — that means a lot. Every tool in Capital Flow is yours now, nothing held back.",
  },
}

export default function WelcomeTierModal({ tier, confirmed, onClose }) {
  const panelRef = useModalA11y(onClose)
  const { getToken } = useAuth()
  const [showConfirming, setShowConfirming] = useState(!confirmed)
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState('')

  // The exact same tier-was-requested handoff UpgradeModal uses — stashed
  // before redirecting to Whop so that if this converts, the user lands back
  // on the (real) Elite welcome screen instead of nothing.
  function upgradeToElite() {
    setUpgradeError('')
    setUpgrading(true)
    fetch('/api/checkout/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ tier: 'eliteUpgrade' }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Could not start checkout')
        localStorage.setItem('vs_pending_tier', 'elite')
        window.location.href = data.purchaseUrl
      })
      .catch((err) => {
        setUpgrading(false)
        setUpgradeError(err.message || 'Something went wrong — please try again.')
      })
  }

  useEffect(
    function () {
      if (confirmed) {
        setShowConfirming(false)
        return
      }
      var t = setTimeout(function () {
        setShowConfirming(false)
      }, CONFIRM_TIMEOUT_MS)
      return function () {
        clearTimeout(t)
      }
    },
    [confirmed]
  )

  var copy = COPY[tier]
  if (!copy) return null
  // Every tier's screen lists the SAME full paid-feature set — Elite checks
  // off all of it (nothing to exclude), Premium checks off its own three and
  // groups the rest into a separate "also included with Elite" section
  // instead of marking them with a rejection-coded × right in the same list.
  var checklist = tierFeatureChecklist(tier)
  var included = checklist.filter(function (f) {
    return f.included
  })
  var excluded = checklist.filter(function (f) {
    return !f.included
  })

  return (
    <div className="upgrade-overlay welcome-tier-overlay" onClick={onClose}>
      <div
        className={'upgrade-modal welcome-tier-modal ' + copy.badgeClass}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={copy.headline}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="welcome-tier-badge-wrap">
          <span className={'welcome-tier-badge ' + copy.badgeClass}>{copy.label}</span>
          {showConfirming && (
            <span className="welcome-tier-confirming">
              <span className="welcome-tier-spinner" />
              Confirming with Whop…
            </span>
          )}
        </div>

        <h2 className="upgrade-title welcome-tier-headline">{copy.headline}</h2>
        <p className="upgrade-desc welcome-tier-body">{copy.body}</p>

        <ul className="welcome-tier-features">
          {included.map((f) => (
            <li key={f.label}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {f.label}
            </li>
          ))}
        </ul>

        {excluded.length > 0 && (
          <>
            <div className="welcome-tier-divider">
              <span className="welcome-tier-divider-label">Also included with Elite</span>
            </div>
            <ul className="welcome-tier-features welcome-tier-features-excluded">
              {excluded.map((f) => (
                <li key={f.label}>
                  <span className="welcome-tier-dot" />
                  {f.label}
                </li>
              ))}
            </ul>
          </>
        )}

        {tier === 'premium' && (
          <div className="welcome-upsell">
            <span className="welcome-upsell-badge">One-time offer</span>
            <button className="upgrade-cta welcome-tier-cta welcome-upsell-cta" onClick={upgradeToElite} disabled={upgrading}>
              {upgrading ? 'Redirecting…' : 'Upgrade to Elite — 50% off'}
            </button>
            <p className="welcome-upsell-sub">
              $14.95 instead of $29.90 — once you leave this screen, this offer disappears.
            </p>
            {upgradeError && <p className="welcome-upsell-error">{upgradeError}</p>}
          </div>
        )}

        <button
          className={'upgrade-cta welcome-tier-cta' + (tier === 'premium' ? ' welcome-tier-cta-secondary' : '')}
          onClick={onClose}
        >
          Start scanning
        </button>
      </div>
    </div>
  )
}
