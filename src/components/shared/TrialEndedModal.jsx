import React from 'react';
import useModalA11y from '../../hooks/useModalA11y';

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10h13" />
      <path d="m11 5 5 5-5 5" />
    </svg>
  );
}

function SignalIcon({ type }) {
  if (type === 'scan') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
        <path
          d="M4 18.5 9 13l3.2 3.2L20 8.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15.5 8.5H20V13"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (type === 'alert') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
        <path
          d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M4 16.5V19h16v-2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 16.5V9h3v7.5M11 16.5V5h3v11.5M15.5 16.5v-5h3v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Conversion gate shown when the free account reaches the end of its
// seven-day full-access window. The screen explains the value the user just
// experienced and gives the two paid paths a concrete identity before the
// full checkout comparison opens.
export default function TrialEndedModal({ onClose, onUpgrade }) {
  const panelRef = useModalA11y(onClose);

  return (
    <div className="upgrade-overlay trial-ended-overlay" onClick={onClose}>
      <div
        className="upgrade-modal trial-ended-modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Your Capital Flow trial is complete"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="trial-ended-topline">
          <div className="trial-ended-brand">
            <img src="/icon-192.png" alt="" />
            <span>CAPITAL FLOW</span>
          </div>
          <span className="trial-ended-status">
            <span className="trial-ended-status-dot" />
            7-DAY TRIAL COMPLETE
          </span>
        </div>

        <div className="trial-ended-hero">
          <div className="trial-ended-eyebrow">Your market workspace is still here</div>
          <h2 className="trial-ended-title">Keep your edge after day seven.</h2>
          <p className="trial-ended-description">
            You have already experienced the full Elite workflow: faster scans, clearer context, and alerts that keep
            working when you are away from the screen. Choose the level of access that matches how you trade.
          </p>
        </div>

        <div className="trial-ended-proof" aria-label="What your trial included">
          <div className="trial-ended-proof-heading">What you just had access to</div>
          <div className="trial-ended-proof-grid">
            <div className="trial-ended-proof-item">
              <span className="trial-ended-proof-icon">
                <SignalIcon type="scan" />
              </span>
              <span>
                <strong>Full scan access</strong>
                <small>Find the signal before the crowd</small>
              </span>
            </div>
            <div className="trial-ended-proof-item">
              <span className="trial-ended-proof-icon">
                <SignalIcon type="alert" />
              </span>
              <span>
                <strong>Alerts that follow through</strong>
                <small>Push, watchlists, and scheduled scans</small>
              </span>
            </div>
            <div className="trial-ended-proof-item">
              <span className="trial-ended-proof-icon">
                <SignalIcon type="context" />
              </span>
              <span>
                <strong>Decision-ready context</strong>
                <small>Fundamentals, charts, news, and Capi</small>
              </span>
            </div>
          </div>
        </div>

        <div className="trial-ended-plan-preview">
          <div className="trial-ended-plan-preview-card">
            <div className="trial-ended-plan-preview-head">
              <span className="trial-ended-plan-name">PREMIUM</span>
              <span className="trial-ended-plan-fit">Focused scanning</span>
            </div>
            <div className="trial-ended-plan-price">
              $14.90 <small>one-time</small>
            </div>
            <p>5 scans / 24h, Fundamentals, charts, filters, and news.</p>
          </div>
          <div className="trial-ended-plan-preview-card trial-ended-plan-preview-featured">
            <div className="trial-ended-plan-preview-head">
              <span className="trial-ended-plan-name">ELITE</span>
              <span className="trial-ended-plan-fit">Active trader workflow</span>
            </div>
            <div className="trial-ended-plan-price">
              $29.90 <small>one-time</small>
            </div>
            <p>Unlimited scans, alerts, push, scheduled scans, and Capi.</p>
          </div>
        </div>

        <button className="upgrade-cta trial-ended-primary" onClick={onUpgrade}>
          <span>See plans and keep scanning</span>
          <ArrowIcon />
        </button>
        <button className="trial-ended-secondary" onClick={onClose}>
          Maybe later
        </button>

        <div className="trial-ended-trust">
          <span>Secure checkout</span>
          <span className="trial-ended-trust-separator" />
          <span>Apple Pay / Google Pay when supported</span>
          <span className="trial-ended-trust-separator" />
          <span>No recurring billing</span>
        </div>
      </div>
    </div>
  );
}
