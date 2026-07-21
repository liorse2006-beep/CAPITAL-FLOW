import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { useAuth } from '../../context/AuthContext';

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Feature rows in display order — Price is last, right above the CTA row.
const ROWS = [
  { label: 'Scans', free: 'Unlimited for 7 days', premium: '5 / 24h', elite: 'Unlimited' },
  { label: 'Advanced filters & presets', free: false, premium: true, elite: true },
  { label: 'Float & short interest data', free: false, premium: true, elite: true },
  { label: 'Ticker notes & charts', free: false, premium: true, elite: true },
  { label: 'Push notifications', free: false, premium: false, elite: true },
  { label: 'Daily scheduled scan', free: false, premium: false, elite: true },
  { label: 'Custom watchlist alerts', free: false, premium: false, elite: true },
  { label: 'Price', free: 'Free', premium: '$14.90', elite: '$29.90', isPrice: true },
];

function Cell({ value, tierClass, isPrice }) {
  if (typeof value === 'string') {
    return <td className={'tier-table-cell ' + tierClass + (isPrice ? ' tier-table-cell-price' : '')}>{value}</td>;
  }
  return (
    <td className={'tier-table-cell ' + tierClass}>
      {value ? (
        <span className="tier-table-icon tier-table-icon-yes">
          <Check />
        </span>
      ) : (
        <span className="tier-table-icon tier-table-icon-no">–</span>
      )}
    </td>
  );
}

const TIER_RANK = { free: 0, premium: 1, elite: 2 };

// Full Free/Premium/Elite feature comparison — one table, every row a
// feature, checkmark/dash (or a value like "5 / 24h") per tier, price as
// the last row right above the CTA buttons. The user's current tier gets a
// "Your plan" badge instead of a CTA button; only tiers above the current
// one show a Get-<tier> button.
//
// Clicking "Get <tier>" goes straight to Whop's hosted checkout page — no
// confirmation screen of our own in between. Whop's own checkout page shows
// the price and has its own promo-code field.
export default function UpgradeModal({ userTier = 'free', onClose }) {
  const { getToken } = useAuth();
  const panelRef = useModalA11y(onClose);
  const [payingTier, setPayingTier] = useState(null);
  const [payError, setPayError] = useState('');

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
      window.location.href = data.purchaseUrl;
    } catch (err) {
      setPayingTier(null);
      setPayError(err.message || 'Something went wrong — please try again.');
    }
  }

  function ctaOrBadge(tierKey, tierLabel, ctaClass) {
    if (userTier === tierKey) {
      return <span className="tier-table-current">Your plan</span>;
    }
    if (TIER_RANK[userTier] > TIER_RANK[tierKey]) return null; // already above this tier
    return (
      <button
        className={'upgrade-cta ' + ctaClass}
        onClick={() => goToCheckout(tierKey)}
        disabled={payingTier === tierKey}
      >
        {payingTier === tierKey ? 'Redirecting…' : 'Get ' + tierLabel}
      </button>
    );
  }

  return (
    <div className="upgrade-overlay" onClick={onClose}>
      <div
        className="upgrade-modal tier-table-modal"
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
        <p className="upgrade-desc" style={{ textAlign: 'center', marginBottom: 20 }}>
          Free gives you unlimited scans for your first 7 days. Pick the plan that fits how you trade.
        </p>

        <div className="tier-table-wrap">
          <table className="tier-table">
            <thead>
              <tr>
                <th className="tier-table-feature-head"></th>
                <th className="tier-table-head">Free</th>
                <th className="tier-table-head tier-table-head-premium">Premium</th>
                <th className="tier-table-head tier-table-head-elite">Elite</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td className="tier-table-feature">{row.label}</td>
                  <Cell value={row.free} tierClass="" isPrice={row.isPrice} />
                  <Cell value={row.premium} tierClass="tier-table-cell-premium" isPrice={row.isPrice} />
                  <Cell value={row.elite} tierClass="tier-table-cell-elite" isPrice={row.isPrice} />
                </tr>
              ))}
              <tr className="tier-table-cta-row">
                <td></td>
                <td className="tier-table-cell">{ctaOrBadge('free', 'Free', '')}</td>
                <td className="tier-table-cell tier-table-cell-premium">
                  {ctaOrBadge('premium', 'Premium', 'tier-table-premium-cta')}
                </td>
                <td className="tier-table-cell tier-table-cell-elite">
                  {ctaOrBadge('elite', 'Elite', 'tier-table-elite-cta')}
                </td>
              </tr>
            </tbody>
          </table>
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
