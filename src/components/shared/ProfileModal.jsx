import React from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import UserAvatar from './UserAvatar';

function accessLabel(user) {
  if (user && user.tier === 'elite') return 'Elite';
  if (user && user.tier === 'premium') return 'Premium';
  if (user && user.elite_access) return '7-day trial';
  return 'Free';
}

export default function ProfileModal({ user, onClose }) {
  const panelRef = useModalA11y(onClose);

  return (
    <div
      className="upgrade-overlay profile-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="upgrade-modal profile-modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close profile">
          ×
        </button>
        <div className="profile-modal-avatar-wrap">
          <UserAvatar user={user} className="profile-modal-avatar" />
        </div>
        <div className="profile-modal-kicker">CAPITAL FLOW</div>
        <h2 id="profile-modal-title" className="upgrade-title">
          Your Profile
        </h2>
        <p className="profile-modal-subtitle">Your account details and access level.</p>

        <div className="profile-modal-details">
          <div className="profile-modal-detail">
            <span className="profile-modal-label">Email</span>
            <span className="profile-modal-value profile-modal-email">{user && user.email ? user.email : '—'}</span>
          </div>
          <div className="profile-modal-detail">
            <span className="profile-modal-label">Access</span>
            <span className="profile-modal-value">{accessLabel(user)}</span>
          </div>
        </div>

        <button className="upgrade-cta profile-modal-close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
