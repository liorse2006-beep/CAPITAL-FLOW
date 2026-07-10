import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';
import { enabled as paddleEnabled, openCheckout } from '../../paddle';

const TIER_LABEL = { premium: 'Premium', elite: 'Elite' };
const BASE_PRICE = { premium: 14.9, elite: 29.9 };

// The actual payment step — opened from UpgradeModal's "Get Premium"/"Get
// Elite" buttons. This is deliberately where the coupon field lives, not
// on the plans comparison table, so it only ever appears once someone is
// about to pay.
export default function CheckoutModal({ tier, onClose }) {
  const { getToken, refreshUser } = useAuth();
  const panelRef = useModalA11y(onClose);
  const [couponInput, setCouponInput] = useState('');
  const [couponStatus, setCouponStatus] = useState('idle'); // idle | checking | applied | error
  const [couponError, setCouponError] = useState('');
  const [discountPercent, setDiscountPercent] = useState(null);
  const [appliedCode, setAppliedCode] = useState('');
  const [payStatus, setPayStatus] = useState('idle'); // idle | opening | success | error
  const [payError, setPayError] = useState('');

  const base = BASE_PRICE[tier];
  const finalPrice = discountPercent ? base * (1 - discountPercent / 100) : base;

  async function applyCoupon(e) {
    e.preventDefault();
    const code = couponInput.trim();
    if (!code) return;
    setCouponStatus('checking');
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tier }),
      });
      const data = await res.json();
      if (!data.valid) {
        setCouponStatus('error');
        setCouponError(data.error || 'Invalid coupon');
        return;
      }
      setDiscountPercent(data.discountPercent);
      setAppliedCode(data.code);
      setCouponStatus('applied');
    } catch {
      setCouponStatus('error');
      setCouponError('Could not check that code — try again.');
    }
  }

  async function pay() {
    setPayStatus('opening');
    setPayError('');
    try {
      const res = await fetch('/api/checkout/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ tier, couponCode: appliedCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');

      const result = await openCheckout({ transactionId: data.transactionId });
      if (result.completed) {
        setPayStatus('success');
        // The tier upgrade lands via a server-side webhook, which can trail
        // the client-side "completed" event by a second or two.
        setTimeout(() => refreshUser(), 2000);
      } else {
        setPayStatus('idle');
      }
    } catch (err) {
      setPayStatus('error');
      setPayError(err.message || 'Something went wrong — please try again.');
    }
  }

  return (
    <div
      className="upgrade-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="upgrade-modal"
        style={{ width: 380 }}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={'Checkout — ' + TIER_LABEL[tier]}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {payStatus === 'success' ? (
          <>
            <h2 className="upgrade-title">Payment received 🎉</h2>
            <p className="upgrade-desc">
              {"You're on " + TIER_LABEL[tier] + " now. This can take a few seconds to reflect in the app."}
            </p>
            <button className="upgrade-cta" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className="upgrade-title">{'Checkout — ' + TIER_LABEL[tier]}</h2>
            <p className="upgrade-desc">One-time payment, no subscription.</p>

            <div className="checkout-price-row">
              {discountPercent ? (
                <>
                  <span className="checkout-price-was">{'$' + base.toFixed(2)}</span>
                  <span className="checkout-price-now">{'$' + finalPrice.toFixed(2)}</span>
                </>
              ) : (
                <span className="checkout-price-now">{'$' + base.toFixed(2)}</span>
              )}
            </div>

            <form className="coupon-apply" onSubmit={applyCoupon}>
              <label htmlFor="checkout-coupon-field" className="sr-only">
                Coupon code
              </label>
              <input
                id="checkout-coupon-field"
                className="coupon-apply-input"
                type="text"
                placeholder="Have a coupon?"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value);
                  if (couponStatus !== 'idle') setCouponStatus('idle');
                }}
              />
              <button
                className="coupon-apply-btn"
                type="submit"
                disabled={!couponInput.trim() || couponStatus === 'checking'}
              >
                {couponStatus === 'checking' ? 'Checking…' : 'Apply'}
              </button>
            </form>
            {couponStatus === 'applied' && (
              <p className="coupon-apply-msg coupon-apply-success">{'✓ ' + appliedCode + ' applied'}</p>
            )}
            {couponStatus === 'error' && <p className="coupon-apply-msg coupon-apply-error">{couponError}</p>}

            {!paddleEnabled ? (
              <p className="upgrade-desc" style={{ marginTop: 16 }}>
                Checkout isn&apos;t available yet — please check back soon.
              </p>
            ) : (
              <button className="upgrade-cta" style={{ marginTop: 16 }} onClick={pay} disabled={payStatus === 'opening'}>
                {payStatus === 'opening' ? 'Opening secure checkout…' : 'Continue to Payment'}
              </button>
            )}
            {payStatus === 'error' && (
              <p className="coupon-apply-msg coupon-apply-error" style={{ marginTop: 10 }}>
                {payError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
