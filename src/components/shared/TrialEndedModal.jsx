import React from 'react';
import useModalA11y from '../../hooks/useModalA11y';

// Small, dismissible popup — shown once automatically the first time a
// free-tier user opens the app after their 7-day trial has ended, and again
// every time they try to run a scan afterward (see the onTrialEnded prop
// threaded through App.jsx / MoneyFlow / MAScannerPage). Reuses the
// UpgradeModal's overlay/card/CTA classes for visual consistency.
export default function TrialEndedModal({ onClose, onUpgrade }) {
  const panelRef = useModalA11y(onClose);

  return (
    <div className="upgrade-overlay" onClick={onClose}>
      <div
        className="upgrade-modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Free trial ended"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="upgrade-icon" style={{ fontSize: 28 }}>
          🎉
        </div>
        <h2 className="upgrade-title">Your 7-day free trial has ended</h2>
        <p className="upgrade-desc">
          We hope you enjoyed exploring Capital Flow! To keep scanning, pick a plan that fits you.
        </p>
        <button className="upgrade-cta" onClick={onUpgrade}>
          Upgrade Now
        </button>
      </div>
    </div>
  );
}
