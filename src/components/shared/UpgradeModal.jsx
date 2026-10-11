import React, { useRef, useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';
import EmbeddedCheckout from './EmbeddedCheckout';
import TierComparisonMatrix from './TierComparisonMatrix';
import { clearWhopReturnState, saveWhopReturnState } from '../../utils/checkoutReturn';

const TIER_LABEL = { premium: 'Premium', elite: 'Elite', eliteUpgrade: 'שדרוג ל־Elite' };
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
      setPayError('לא הצלחנו לפתוח את התשלום. אפשר לנסות שוב.');
    } finally {
      setPayingTier(null);
    }
  }

  function handlePaymentError() {
    setPayError('התשלום המאובטח אינו זמין כרגע. אפשר לנסות שוב.');
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
          dir="rtl"
          lang="he"
          aria-label={'תשלום — ' + TIER_LABEL[checkoutSession.tierKey]}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="upgrade-close" onClick={handleClose} aria-label="סגירה">
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
            חזרה למסלולים
          </button>
          <h2 className="upgrade-title" style={{ textAlign: 'center', marginBottom: 16 }}>
            תשלום עבור {TIER_LABEL[checkoutSession.tierKey]}
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
        dir="rtl"
        lang="he"
        aria-label={trialEnded ? 'המשך הגישה ל־Capital Flow' : 'בחירת מסלול'}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={handleClose} aria-label="סגירה">
          ×
        </button>
        {trialEnded && (
          <div className="upgrade-context-row">
            <span className="upgrade-context-badge">
              <img src="/icon-192.png" alt="" />
              <span>תקופת הניסיון הסתיימה</span>
            </span>
            <span className="upgrade-context-meta">ההגדרות שלך נשמרו</span>
          </div>
        )}
        <div className="upgrade-header">
          <div className="upgrade-header-eyebrow">
            {trialEnded ? 'המשך שימוש ב־Capital Flow' : 'מסלולי Capital Flow'}
          </div>
          <h2 className="upgrade-title">{trialEnded ? 'ממשיכים גם אחרי הניסיון.' : 'בחירת המסלול המתאים לך.'}</h2>
          {trialEnded && (
            <p className="upgrade-desc">אפשר לבחור את רמת הגישה המתאימה לך — תשלום חד־פעמי, ללא חיוב חודשי.</p>
          )}
        </div>
        {trialEnded && (
          <div className="upgrade-proof-strip" aria-label="יתרונות המסלול">
            <span>
              <strong>תשלום חד־פעמי</strong>
              <small>גישה ללא הגבלת זמן</small>
            </span>
            <span>
              <strong>ההגדרות נשמרות</strong>
              <small>המניות והתזמונים נשארים</small>
            </span>
            <span>
              <strong>כלים למחקר</strong>
              <small>סריקה, סינון ומעקב</small>
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
          <span>תשלום מאובטח</span>
          <span className="upgrade-trust-separator" />
          <span>Apple Pay ו־Google Pay במכשירים נתמכים</span>
          <span className="upgrade-trust-separator" />
          <span>ללא חיוב חוזר</span>
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
