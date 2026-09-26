import React, { useRef, useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';
import EmbeddedCheckout from './EmbeddedCheckout';
import TierComparisonMatrix from './TierComparisonMatrix';
import { clearWhopReturnState, saveWhopReturnState } from '../../utils/checkoutReturn';

const TIER_LABEL = { premium: 'Premium', elite: 'Elite', eliteUpgrade: 'Elite upgrade' };
//
// Clicking "Get <tier>" swaps this same modal over to Whop's checkout
// Elements checkout, mounted inline. The server returns an allowlisted plan
// and HMAC-signed account metadata; the webhook alone grants the paid tier.
export default function UpgradeModal({ userTier = 'free', onClose, trialEnded = false }) {
  const { getToken, user } = useAuth();
  const [payingTier, setPayingTier] = useState(null);
  const [payError, setPayError] = useState('');
  const [checkoutSession, setCheckoutSession] = useState(null); // { planId, metadata, promoCode, tier, tierKey } | null
  const checkoutSessionRef = useRef(false);
  React.useEffect(() => {
    checkoutSessionRef.current = Boolean(checkoutSession);
  }, [checkoutSession]);

  function handleClose() {
    if (checkoutSessionRef.current) {
      localStorage.removeItem('vs_pending_tier');
      clearWhopReturnState();
    }
    onClose();
  }

  const panelRef = useModalA11y(handleClose);

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
      if (
        !data.planId ||
        !data.metadata ||
        typeof data.metadata.metadataSignature !== 'string' ||
        !['premium', 'elite'].includes(data.tier)
      ) {
        throw new Error('Secure checkout could not be prepared. Please try again.');
      }
      // This is only a UI handoff hint. The webhook remains the authority
      // that changes the user's tier after Whop confirms payment.
      localStorage.setItem('vs_pending_tier', data.tier);
      saveWhopReturnState();
      setCheckoutSession({
        planId: data.planId,
        metadata: data.metadata,
        promoCode: data.couponCode || '',
        tier: data.tier,
        tierKey,
      });
    } catch (err) {
      setPayError(err.message || 'Something went wrong — please try again.');
    } finally {
      setPayingTier(null);
    }
  }

  function handlePaymentError() {
    setPayError('Secure checkout is temporarily unavailable. Please try again.');
    setCheckoutSession(null);
    localStorage.removeItem('vs_pending_tier');
    clearWhopReturnState();
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
              localStorage.removeItem('vs_pending_tier');
              clearWhopReturnState();
            }}
          >
            ‹ Back to plans
          </button>
          <h2 className="upgrade-title" style={{ textAlign: 'center', marginBottom: 16 }}>
            {TIER_LABEL[checkoutSession.tierKey]} checkout
          </h2>
          <EmbeddedCheckout
            planId={checkoutSession.planId}
            metadata={checkoutSession.metadata}
            promoCode={checkoutSession.promoCode}
            buyerEmail={user?.email}
            onError={handlePaymentError}
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

        <TierComparisonMatrix
          userTier={userTier}
          trialEnded={trialEnded}
          payingTier={payingTier}
          onCheckout={goToCheckout}
        />
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
