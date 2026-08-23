import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';
import { TIER_ROWS, tierFeatureChecklist } from '../../constants/tierFeatures';
import EmbeddedCheckout from './EmbeddedCheckout';

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const TIER_RANK = { free: 0, premium: 1, elite: 2 };
const TIER_LABEL = { premium: 'Premium', elite: 'Elite' };

const PRICE_ROW = TIER_ROWS.find((row) => row.isPrice);
const SCANS_ROW = TIER_ROWS.find((row) => row.label === 'Scans');
const FUNDAMENTALS_ROW = TIER_ROWS.find((row) => row.label === 'Fundamentals lookups');

// One card per tier — everything a card needs to render itself, so the JSX
// below is just a .map() instead of three near-identical blocks that drift
// out of sync every time a tier's copy changes.
const CARD_TIERS = [
  { key: 'free', label: 'Free', accentClass: '' },
  { key: 'premium', label: 'Premium', accentClass: 'pricing-card-premium', featured: false },
  { key: 'elite', label: 'Elite', accentClass: 'pricing-card-elite', featured: true },
];

const TIER_POSITIONING = {
  free: {
    eyebrow: 'Explore the basics',
    copy: 'Keep your account ready for the next setup.',
  },
  premium: {
    eyebrow: 'Focused scanning',
    copy: 'The essential toolkit for deliberate, repeatable scans.',
  },
  elite: {
    eyebrow: 'Active trader workflow',
    copy: 'The complete signal loop: speed, alerts, and Capi in one place.',
  },
};

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
export default function UpgradeModal({ userTier = 'free', onClose, trialEnded = false }) {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const panelRef = useModalA11y(onClose);
  const [payingTier, setPayingTier] = useState(null);
  const [payError, setPayError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [checkoutSession, setCheckoutSession] = useState(null); // { sessionId, tierKey, promoCode, discountPercent } | null
  const visibleCardTiers = trialEnded ? CARD_TIERS.filter((t) => t.key !== 'free') : CARD_TIERS;

  async function goToCheckout(tierKey) {
    setPayError('');
    setPayingTier(tierKey);
    try {
      const trimmedCoupon = couponCode.trim();
      const res = await fetch('/api/checkout/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ tier: tierKey, ...(trimmedCoupon ? { couponCode: trimmedCoupon } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      if (!data.sessionId) throw new Error('Checkout session was not created — please try again.');
      // The completion callback only tells us the checkout finished, not
      // which tier was bought — stash it so the welcome screen can show the
      // right badge/copy immediately instead of waiting on the webhook.
      localStorage.setItem('vs_pending_tier', tierKey);
      setCheckoutSession({
        sessionId: data.sessionId,
        planId: data.planId,
        tierKey,
        promoCode: data.couponCode,
        discountPercent: data.discountPercent,
      });
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
        {payingTier === tierKey
          ? 'Loading…'
          : trialEnded
            ? tierKey === 'elite'
              ? 'Unlock Elite'
              : 'Keep scanning with Premium'
            : 'Get ' + tierLabel}
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
          <p className="checkout-embed-promo-hint">
            {checkoutSession.promoCode
              ? `Coupon "${checkoutSession.promoCode}" applied — if it doesn't show as active below, you can also re-enter it directly in the secure checkout.`
              : 'If you have a promo code, a field for it will appear inside the secure checkout below — it only shows up while a promo is actually active, so don’t worry if you don’t see one.'}
          </p>
          <EmbeddedCheckout
            sessionId={checkoutSession.sessionId}
            planId={checkoutSession.planId}
            promoCode={checkoutSession.promoCode}
            onComplete={handleComplete}
            onError={handlePaymentError}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="upgrade-overlay" onClick={onClose}>
      <div
        className={'upgrade-modal pricing-cards-modal' + (trialEnded ? ' pricing-cards-modal-trial-ended' : '')}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={trialEnded ? 'Keep your Capital Flow access' : 'Compare plans'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {trialEnded && (
          <div className="upgrade-context-row">
            <span className="upgrade-context-badge">
              <img src="/icon-192.png" alt="" />
              <span>TRIAL COMPLETE</span>
            </span>
            <span className="upgrade-context-meta">Your workspace is saved</span>
          </div>
        )}
        <div className="upgrade-header">
          <div className="upgrade-header-eyebrow">{trialEnded ? 'CAPITAL FLOW MEMBERSHIP' : 'CAPITAL FLOW PLANS'}</div>
          <h2 className="upgrade-title">
            {trialEnded ? 'Keep your edge after the trial.' : 'Choose the workflow that fits your trading.'}
          </h2>
          {trialEnded && (
            <p className="upgrade-desc">
              You have already felt the full Elite workflow. Choose the level of access that matches how you trade — one
              payment, lifetime access.
            </p>
          )}
        </div>
        {trialEnded && (
          <div className="upgrade-proof-strip" aria-label="Membership highlights">
            <span>
              <strong>One payment</strong>
              <small>Lifetime access</small>
            </span>
            <span>
              <strong>Keep your workspace</strong>
              <small>Saved settings stay in place</small>
            </span>
            <span>
              <strong>Built for action</strong>
              <small>Scan, filter, decide</small>
            </span>
          </div>
        )}

        <div className={'pricing-cards' + (trialEnded ? ' pricing-cards-paid' : '')}>
          {visibleCardTiers.map((t) => {
            const checklist = tierFeatureChecklist(t.key);
            const positioning = TIER_POSITIONING[t.key];
            return (
              <div
                key={t.key}
                className={'pricing-card ' + t.accentClass + (t.featured ? ' pricing-card-featured' : '')}
              >
                {t.featured && <div className="pricing-card-ribbon">Most Popular</div>}

                <div className="pricing-card-topline">
                  <div className="pricing-card-tier">{t.label}</div>
                  <span className="pricing-card-positioning">{positioning.eyebrow}</span>
                </div>
                <div className="pricing-card-price">{PRICE_ROW[t.key]}</div>
                {t.key === 'free' ? (
                  <div className="pricing-card-subprice">Full access, 7 days</div>
                ) : (
                  <div className="pricing-card-subprice pricing-card-subprice-onetime">
                    One-time payment · Lifetime access
                  </div>
                )}
                <p className="pricing-card-pitch">{positioning.copy}</p>

                <div className="pricing-card-scans">{SCANS_ROW[t.key]}</div>
                <div className="pricing-card-scans pricing-card-fundamentals">
                  Fundamentals: {FUNDAMENTALS_ROW[t.key]}
                </div>

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
                      <span className="pricing-card-feature-copy">
                        <span>{f.label}</span>
                        {f.value && f.value !== 'Included' && <small>{f.value}</small>}
                      </span>
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
        <div className="coupon-input-row">
          <label htmlFor="upgrade-coupon-input" className="coupon-input-label">
            Have a coupon code?
          </label>
          <input
            id="upgrade-coupon-input"
            className="coupon-input"
            type="text"
            placeholder="COUPON CODE"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            autoCapitalize="characters"
          />
        </div>
        <div className="upgrade-trust-row">
          <span>Secure checkout</span>
          <span className="upgrade-trust-separator" />
          <span>Apple Pay / Google Pay when supported</span>
          <span className="upgrade-trust-separator" />
          <span>No recurring billing</span>
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
