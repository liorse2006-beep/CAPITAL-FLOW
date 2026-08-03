import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';
import { TIER_ROWS, tierFeatureChecklist } from '../../constants/tierFeatures';
import EmbeddedCheckout from './EmbeddedCheckout';

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const TIER_RANK = { free: 0, premium: 1, elite: 2 };
const TIER_LABEL = { premium: 'Premium', elite: 'Elite' };

const PRICE_ROW = TIER_ROWS.find((row) => row.isPrice);
const SCANS_ROW = TIER_ROWS.find((row) => row.label === 'Scans');

// One card per tier — everything a card needs to render itself, so the JSX
// below is just a .map() instead of three near-identical blocks that drift
// out of sync every time a tier's copy changes.
const CARD_TIERS = [
  { key: 'free', label: 'Free', accentClass: '' },
  { key: 'premium', label: 'Premium', accentClass: 'pricing-card-premium', featured: false },
  { key: 'elite', label: 'Elite', accentClass: 'pricing-card-elite', featured: true },
];

// Full Free/Premium/Elite feature comparison — one table, every row a
// feature, checkmark/dash (or a value like "5 / 24h") per tier, price as
// the last row right above the CTA buttons. The user's current tier gets a
// "Your plan" badge instead of a CTA button; only tiers above the current
// one show a Get-<tier> button.
//
// Clicking "Get <tier>" swaps this same modal over to Whop's checkout
// embed, mounted inline (an iframe scoped to the payment form) — the user
// never leaves the page or sees a Whop-hosted URL. The embed still needs a
// server-created checkout session first, since that's what carries the
// userId/tier metadata the webhook reads back once payment succeeds.
export default function UpgradeModal({ userTier = 'free', onClose }) {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const panelRef = useModalA11y(onClose);
  const [payingTier, setPayingTier] = useState(null);
  const [payError, setPayError] = useState('');
  const [checkoutSession, setCheckoutSession] = useState(null); // { sessionId, tierKey } | null

  async function goToCheckout(tierKey) {
    setPayError('');
    setPayingTier(tierKey);
    try {
      const res = await fetch('/api/checkout/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ tier: tierKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      if (!data.sessionId) throw new Error('Checkout session was not created — please try again.');
      // The completion callback only tells us the checkout finished, not
      // which tier was bought — stash it so the welcome screen can show the
      // right badge/copy immediately instead of waiting on the webhook.
      localStorage.setItem('vs_pending_tier', tierKey);
      setCheckoutSession({ sessionId: data.sessionId, tierKey });
    } catch (err) {
      setPayError(err.message || 'Something went wrong — please try again.');
    } finally {
      setPayingTier(null);
    }
  }

  function handleComplete() {
    // Reuses the exact same ?status=success handling App.jsx already has
    // for the old hosted-redirect flow (shows the welcome modal, refreshes
    // the real tier from the server) — same outcome, just never left the page.
    navigate(location.pathname + '?status=success', { replace: false });
  }

  function handlePaymentError(error) {
    setPayError((error && error.message) || 'Payment failed — please try again.');
    setCheckoutSession(null);
    localStorage.removeItem('vs_pending_tier');
  }

  function ctaOrBadge(tierKey, tierLabel, ctaClass) {
    if (userTier === tierKey) {
      return <span className="pricing-card-current">Your plan</span>;
    }
    if (TIER_RANK[userTier] > TIER_RANK[tierKey]) return null; // already above this tier
    return (
      <button
        className={'upgrade-cta pricing-card-cta ' + ctaClass}
        onClick={() => goToCheckout(tierKey)}
        disabled={payingTier === tierKey}
      >
        {payingTier === tierKey ? 'Loading…' : 'Get ' + tierLabel}
      </button>
    );
  }

  if (checkoutSession) {
    return (
      <div className="upgrade-overlay" onClick={onClose}>
        <div
          className="upgrade-modal checkout-embed-modal"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={'Checkout — ' + TIER_LABEL[checkoutSession.tierKey]}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="upgrade-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <button
            className="checkout-embed-back"
            onClick={() => {
              setCheckoutSession(null);
              localStorage.removeItem('vs_pending_tier');
            }}
          >
            ‹ Back to plans
          </button>
          <h2 className="upgrade-title" style={{ textAlign: 'center', marginBottom: 16 }}>
            {TIER_LABEL[checkoutSession.tierKey]} checkout
          </h2>
          <p className="checkout-embed-promo-hint">Have a promo code? Enter it securely in the Whop checkout below.</p>
          <EmbeddedCheckout sessionId={checkoutSession.sessionId} onComplete={handleComplete} onError={handlePaymentError} />
        </div>
      </div>
    );
  }

  return (
    <div className="upgrade-overlay" onClick={onClose}>
      <div
        className="upgrade-modal pricing-cards-modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Compare plans"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="upgrade-title" style={{ textAlign: 'center', marginBottom: 4 }}>
          Compare plans
        </h2>
        <p className="upgrade-desc" style={{ textAlign: 'center', marginBottom: 24 }}>
          Free gives you unlimited scans for your first 7 days. Pick the plan that fits how you trade.
        </p>

        <div className="pricing-cards">
          {CARD_TIERS.map((t) => {
            const checklist = tierFeatureChecklist(t.key);
            return (
              <div key={t.key} className={'pricing-card ' + t.accentClass + (t.featured ? ' pricing-card-featured' : '')}>
                {t.featured && <div className="pricing-card-ribbon">Most Popular</div>}

                <div className="pricing-card-tier">{t.label}</div>
                <div className="pricing-card-price">{PRICE_ROW[t.key]}</div>
                {t.key === 'free' ? (
                  <div className="pricing-card-subprice">Full access, 7 days</div>
                ) : (
                  <div className="pricing-card-subprice pricing-card-subprice-onetime">One-time payment · Lifetime access</div>
                )}

                <div className="pricing-card-scans">{SCANS_ROW[t.key]}</div>

                <ul className="pricing-card-features">
                  {checklist.map((f) => (
                    <li key={f.label} className={f.included ? '' : 'pricing-card-feature-off'}>
                      {f.included ? (
                        <span className="pricing-card-feature-icon pricing-card-feature-yes">
                          <Check />
                        </span>
                      ) : (
                        <span className="pricing-card-feature-icon pricing-card-feature-no">–</span>
                      )}
                      {f.label}
                    </li>
                  ))}
                </ul>

                <div className="pricing-card-cta-slot">
                  {t.key === 'free'
                    ? ctaOrBadge('free', 'Free', '')
                    : ctaOrBadge(t.key, t.label, 'pricing-card-cta-' + t.key)}
                </div>
              </div>
            );
          })}
        </div>
        {payError && (
          <p className="coupon-apply-msg coupon-apply-error" style={{ textAlign: 'center', marginTop: 12 }}>
            {payError}
          </p>
        )}
      </div>
    </div>
  );
}
