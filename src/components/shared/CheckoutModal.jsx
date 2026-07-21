import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';

const TIER_LABEL = { premium: 'Premium', elite: 'Elite' };
const BASE_PRICE = { premium: 14.9, elite: 29.9 };

// The actual payment step — opened from UpgradeModal's "Get Premium"/"Get
// Elite" buttons. This is deliberately where the coupon field lives, not
// on the plans comparison table, so it only ever appears once someone is
// about to pay.
export default function CheckoutModal({ tier, onClose }) {
  const { getToken } = useAuth();
  const panelRef = useModalA11y(onClose);
  const [couponInput, setCouponInput] = useState('');
  const [couponStatus, setCouponStatus] = useState('idle'); // idle | checking | applied | error
  const [couponError, setCouponError] = useState('');
  const [discountPercent, setDiscountPercent] = useState(null);
  const [appliedCode, setAppliedCode] = useState('');
  const [payStatus, setPayStatus] = useState('idle'); // idle | opening | error
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

      // Full-page redirect to Whop's hosted checkout — it sends the browser
      // back to /?checkout=success afterward (see server/routes/checkout.js),
      // where App.jsx picks up the tier change.
      window.location.href = data.purchaseUrl;
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

        <button className="upgrade-cta" style={{ marginTop: 16 }} onClick={pay} disabled={payStatus === 'opening'}>
          {payStatus === 'opening' ? 'Redirecting to secure checkout…' : 'Continue to Payment'}
        </button>
        {payStatus === 'error' && (
          <p className="coupon-apply-msg coupon-apply-error" style={{ marginTop: 10 }}>
            {payError}
          </p>
        )}
      </div>
    </div>
  );
}
