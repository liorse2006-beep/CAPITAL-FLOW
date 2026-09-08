import React, { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useModalA11y from '../../hooks/useModalA11y';
import { tierFeatureChecklist } from '../../constants/tierFeatures';
import { useAuth } from '../../context/AuthContext';
import EmbeddedCheckout from './EmbeddedCheckout';

var COPY = {
  premium: {
    label: 'PREMIUM',
    badgeClass: 'tier-premium',
    headline: 'Premium is ready',
    body: 'Your Premium access is active. Start scanning when you’re ready.',
  },
  elite: {
    label: 'ELITE',
    badgeClass: 'tier-elite',
    headline: 'Elite is ready',
    body: 'Your Elite access is active. Every Capital Flow tool is ready for you.',
  },
};

export default function WelcomeTierModal({ tier, confirmed, onClose, eliteUpgradeAvailable = true }) {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  const [checkoutSessionId, setCheckoutSessionId] = useState(null);
  const checkoutSessionRef = useRef(false);
  React.useEffect(() => {
    checkoutSessionRef.current = Boolean(checkoutSessionId);
  }, [checkoutSessionId]);

  function handleClose() {
    if (checkoutSessionRef.current) localStorage.removeItem('vs_pending_tier');
    onClose();
  }

  const panelRef = useModalA11y(handleClose);

  // The exact same tier-was-requested handoff UpgradeModal uses — stashed
  // before mounting the embed so that if this converts, the user lands back
  // on the (real) Elite welcome screen instead of nothing.
  function upgradeToElite() {
    setUpgradeError('');
    setUpgrading(true);
    fetch('/api/checkout/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ tier: 'eliteUpgrade' }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Could not start checkout');
        if (!data.sessionId) throw new Error('Checkout session was not created — please try again.');
        localStorage.setItem('vs_pending_tier', 'elite');
        setCheckoutSessionId(data.sessionId);
      })
      .catch((err) => {
        setUpgradeError(err.message || 'Something went wrong — please try again.');
      })
      .finally(() => setUpgrading(false));
  }

  function handleComplete() {
    // Same ?status=success handling App.jsx already has for the old
    // hosted-redirect flow — shows the real (now Elite) welcome screen once
    // the webhook confirms, without ever leaving this page.
    navigate(location.pathname + '?status=success', { replace: false });
  }

  function handlePaymentError(error) {
    setUpgradeError((error && error.message) || 'Payment failed — please try again.');
    setCheckoutSessionId(null);
    localStorage.removeItem('vs_pending_tier');
  }

  var copy = COPY[tier];
  if (!copy) return null;
  // Every tier's screen lists the SAME full feature set — Elite checks off
  // all of it (nothing to exclude), Premium checks off its Elite-only items
  // and groups the rest into a separate "also included with Elite" section
  // instead of marking them with a rejection-coded × right in the same list.
  var checklist = tierFeatureChecklist(tier);
  var included = checklist.filter(function (f) {
    return f.included;
  });
  var excluded = checklist.filter(function (f) {
    return !f.included;
  });

  if (checkoutSessionId) {
    return (
      <div className="upgrade-overlay welcome-tier-overlay" onClick={handleClose}>
        <div
          className="upgrade-modal checkout-embed-modal"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Checkout — Elite"
          onClick={(e) => e.stopPropagation()}
        >
          <button className="upgrade-close" onClick={handleClose} aria-label="Close">
            ×
          </button>
          <button
            className="checkout-embed-back"
            onClick={() => {
              setCheckoutSessionId(null);
              localStorage.removeItem('vs_pending_tier');
            }}
          >
            ‹ Back
          </button>
          <h2 className="upgrade-title" style={{ textAlign: 'center', marginBottom: 16 }}>
            Elite checkout
          </h2>
          <EmbeddedCheckout sessionId={checkoutSessionId} onComplete={handleComplete} onError={handlePaymentError} />
        </div>
      </div>
    );
  }

  return (
    <div className="upgrade-overlay welcome-tier-overlay" onClick={handleClose}>
      <div
        className={'upgrade-modal welcome-tier-modal ' + copy.badgeClass}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={confirmed ? copy.headline : 'Confirming your access'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={handleClose} aria-label="Close">
          ×
        </button>

        <div className="welcome-tier-badge-wrap">
          <span className={'welcome-tier-badge ' + copy.badgeClass}>{confirmed ? copy.label : 'PAYMENT RECEIVED'}</span>
          {!confirmed && (
            <span className="welcome-tier-confirming" role="status" aria-live="polite">
              <span className="welcome-tier-spinner" aria-hidden="true" />
              Activating access…
            </span>
          )}
        </div>

        {!confirmed ? (
          <>
            <h2 className="upgrade-title welcome-tier-headline">Activating your access</h2>
            <p className="upgrade-desc welcome-tier-body welcome-tier-pending-body">
              Your payment was received. We’re securely activating your plan now.
            </p>
            <button className="upgrade-cta welcome-tier-cta welcome-tier-cta-secondary" onClick={handleClose}>
              Continue
            </button>
          </>
        ) : (
          <>
            <h2 className="upgrade-title welcome-tier-headline">{copy.headline}</h2>
            <p className="upgrade-desc welcome-tier-body">{copy.body}</p>

            <ul className="welcome-tier-features">
              {included.map((f) => (
                <li key={f.label}>
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>
                    {f.label}
                    {f.value && f.value !== 'Included' && (
                      <small className="welcome-tier-feature-detail">{f.value}</small>
                    )}
                  </span>
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
                      <span>
                        {f.label}
                        {f.value && f.value !== 'Included' && (
                          <small className="welcome-tier-feature-detail">{f.value}</small>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {tier === 'premium' && eliteUpgradeAvailable && (
              <div className="welcome-upsell">
                <span className="welcome-upsell-badge">One-time offer</span>
                <button
                  className="upgrade-cta welcome-tier-cta welcome-upsell-cta"
                  onClick={upgradeToElite}
                  disabled={upgrading}
                >
                  {upgrading ? 'Loading…' : 'Upgrade to Elite — 50% off'}
                </button>
                <p className="welcome-upsell-sub">
                  $14.95 instead of $29.90 — a one-time 50% upgrade offer shown only after Premium purchase.
                </p>
                {upgradeError && <p className="welcome-upsell-error">{upgradeError}</p>}
              </div>
            )}

            <button
              className={'upgrade-cta welcome-tier-cta' + (tier === 'premium' ? ' welcome-tier-cta-secondary' : '')}
              onClick={handleClose}
            >
              Start scanning
            </button>
          </>
        )}
      </div>
    </div>
  );
}
