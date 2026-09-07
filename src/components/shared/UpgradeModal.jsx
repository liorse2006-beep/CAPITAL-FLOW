import React, { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';
import EmbeddedCheckout from './EmbeddedCheckout';
import { TIER_COLUMNS } from '../../constants/tierFeatures';

const TIER_LABEL = { premium: 'Premium', elite: 'Elite' };
const TIER_RANK = { free: 0, premium: 1, elite: 2 };
const PLAN_SUMMARIES = {
  premium: '5 scans per 24 hours, charts, and advanced filters.',
  elite: 'Unlimited scans, alerts, schedules, and Radar.',
};
const PLAN_OPTIONS = TIER_COLUMNS.filter((column) => column.key !== 'free');

function PlanOption({ column, userTier, trialEnded, payingTier, onCheckout }) {
  const headingId = 'upgrade-plan-' + column.key + '-heading';
  const isCurrent = userTier === column.key;
  const canChoose = !isCurrent && (TIER_RANK[userTier] || 0) <= TIER_RANK[column.key];
  const buttonLabel = trialEnded
    ? column.key === 'elite'
      ? 'Unlock Elite'
      : 'Keep scanning with Premium'
    : 'Get ' + column.label;

  return (
    <article
      className={'upgrade-plan-option' + (column.featured ? ' is-featured' : '')}
      aria-labelledby={headingId}
    >
      <header className="upgrade-plan-option-header">
        {column.featured && <span className="upgrade-plan-option-badge">Most popular</span>}
        <h3 id={headingId} className="upgrade-plan-option-name">
          {column.label}
        </h3>
        <strong className="upgrade-plan-option-price">{column.price}</strong>
        <span className="upgrade-plan-option-details">{column.details}</span>
      </header>
      <p className="upgrade-plan-option-summary">{PLAN_SUMMARIES[column.key]}</p>
      <footer className="upgrade-plan-option-footer">
        {isCurrent ? (
          <span className="upgrade-plan-option-current">Your plan</span>
        ) : canChoose ? (
          <button
            className={'upgrade-cta upgrade-plan-option-cta upgrade-plan-option-cta-' + column.key}
            onClick={() => onCheckout(column.key)}
            disabled={payingTier === column.key}
          >
            {payingTier === column.key ? 'Loading…' : buttonLabel}
          </button>
        ) : (
          <span className="upgrade-plan-option-current">Included in your access</span>
        )}
      </footer>
    </article>
  );
}
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
  const [payingTier, setPayingTier] = useState(null);
  const [payError, setPayError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [checkoutSession, setCheckoutSession] = useState(null); // { sessionId, tierKey, promoCode } | null
  const checkoutSessionRef = useRef(false);
  React.useEffect(() => {
    checkoutSessionRef.current = Boolean(checkoutSession);
  }, [checkoutSession]);

  function handleClose() {
    if (checkoutSessionRef.current) localStorage.removeItem('vs_pending_tier');
    onClose();
  }

  const panelRef = useModalA11y(handleClose);

  async function goToCheckout(tierKey) {
    setPayError('');
    setAppliedPromo(null);
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
        tierKey,
        promoCode: data.couponCode,
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
    setAppliedPromo(null);
    localStorage.removeItem('vs_pending_tier');
  }

  if (checkoutSession) {
    return (
      <div className="upgrade-overlay" onClick={handleClose}>
        <div
          className="upgrade-modal checkout-embed-modal"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={'Checkout — ' + TIER_LABEL[checkoutSession.tierKey]}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="upgrade-close" onClick={handleClose} aria-label="Close">
            ×
          </button>
          <button
            className="checkout-embed-back"
            onClick={() => {
              setCheckoutSession(null);
              setAppliedPromo(null);
              localStorage.removeItem('vs_pending_tier');
            }}
          >
            ‹ Back to plans
          </button>
          <h2 className="upgrade-title" style={{ textAlign: 'center', marginBottom: 16 }}>
            {TIER_LABEL[checkoutSession.tierKey]} checkout
          </h2>
          <p className="checkout-embed-promo-hint">
            {appliedPromo
              ? `Promo code "${appliedPromo.code}" is active. The final amount shown in the secure checkout is the amount charged.`
              : checkoutSession.promoCode
                ? `Promo code "${checkoutSession.promoCode}" was sent to the secure checkout. The final amount shown there is authoritative.`
                : 'Have a promo code? Enter it inside the secure checkout. The final amount shown there is the amount charged.'}
          </p>
          <EmbeddedCheckout
            sessionId={checkoutSession.sessionId}
            promoCode={checkoutSession.promoCode}
            onComplete={handleComplete}
            onError={handlePaymentError}
            onPromoCodeChanged={setAppliedPromo}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="upgrade-overlay" onClick={handleClose}>
      <div
        className={'upgrade-modal upgrade-plan-modal' + (trialEnded ? ' upgrade-plan-modal-trial-ended' : '')}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
         aria-label={trialEnded ? 'Keep your Capital Flow access' : 'Choose a plan'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={handleClose} aria-label="Close">
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

        <div className="upgrade-plan-options" aria-label="Available plans">
          {PLAN_OPTIONS.map((column) => (
            <PlanOption
              key={column.key}
              column={column}
              userTier={userTier}
              trialEnded={trialEnded}
              payingTier={payingTier}
              onCheckout={goToCheckout}
            />
          ))}
        </div>
        <div className="coupon-input-row">
          <label htmlFor="upgrade-coupon-input" className="coupon-input-label">
            Have a promo code?
          </label>
          <input
            id="upgrade-coupon-input"
            className="coupon-input"
            type="text"
            placeholder="PROMO CODE"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            aria-describedby="upgrade-coupon-help"
          />
          <span id="upgrade-coupon-help" className="coupon-input-help">
            The secure checkout confirms the final price.
          </span>
        </div>
        <div className="upgrade-trust-row">
          <span>Secure checkout</span>
          <span className="upgrade-trust-separator" />
          <span>Apple Pay / Google Pay when supported</span>
          <span className="upgrade-trust-separator" />
          <span>No recurring billing</span>
        </div>
        {payError && (
          <p className="upgrade-payment-error" role="alert">
            {payError}
          </p>
        )}
      </div>
    </div>
  );
}
