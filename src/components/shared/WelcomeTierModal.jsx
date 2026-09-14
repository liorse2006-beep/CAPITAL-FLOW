import React from 'react';
import useModalA11y from '../../hooks/useModalA11y';

const COPY = {
  premium: {
    planName: 'Premium',
    badgeClass: 'tier-premium',
    readyBody: 'Your Premium access is active. You can start scanning now.',
  },
  elite: {
    planName: 'Elite',
    badgeClass: 'tier-elite',
    readyBody: 'Your Elite access is active. You can start scanning now.',
  },
};

function AccessIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Single post-purchase handoff. The callback opens this screen immediately;
// the server-confirmed tier then changes the screen from waiting to ready.
// The customer never has to refresh, enter anything, or choose another path.
export default function WelcomeTierModal({ tier, confirmed, onClose }) {
  const panelRef = useModalA11y(onClose);
  const copy = COPY[tier];

  if (!copy) return null;

  return (
    <div
      className={'upgrade-overlay welcome-tier-overlay' + (!confirmed ? ' welcome-tier-overlay-pending' : '')}
      onClick={onClose}
    >
      <div
        className={
          'upgrade-modal welcome-tier-modal ' + copy.badgeClass + (!confirmed ? ' welcome-tier-modal-pending' : '')
        }
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={confirmed ? 'Thank you for your purchase' : 'Payment received — activating access'}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {confirmed ? (
          <div className="welcome-tier-badge-wrap">
            <span className={'welcome-tier-badge ' + copy.badgeClass}>{tier.toUpperCase()}</span>
          </div>
        ) : (
          <div className="welcome-tier-pending-visual" aria-hidden="true">
            <span className="welcome-tier-pending-icon">
              <AccessIcon />
            </span>
          </div>
        )}

        <div className="welcome-tier-eyebrow">{confirmed ? 'ACCESS READY' : 'PAYMENT RECEIVED'}</div>
        <h2 className="upgrade-title welcome-tier-headline">Thank you for your purchase</h2>

        {confirmed ? (
          <>
            <p className="upgrade-desc welcome-tier-body">{copy.readyBody}</p>
            <button className="upgrade-cta welcome-tier-cta" onClick={onClose}>
              START SCANNING
            </button>
            <p className="welcome-tier-close-note">Or close this message with × to continue.</p>
          </>
        ) : (
          <>
            <p className="upgrade-desc welcome-tier-body welcome-tier-pending-body">
              Your {copy.planName} access is being prepared. This usually takes a few seconds.
            </p>
            <p className="welcome-tier-pending-supporting">We&apos;re activating your access securely.</p>
            <div className="welcome-tier-pending-status" role="status" aria-live="polite">
              <span className="welcome-tier-spinner" aria-hidden="true" />
              <span>ACTIVATING ACCESS</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
