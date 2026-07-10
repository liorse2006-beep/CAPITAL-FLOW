import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';

const CONFIRM_WORD = 'DELETE';

// Irreversible — requires typing a confirmation word (not just a click) so
// this can't be triggered by a stray tap. Calls DELETE /api/auth/account
// (server/routes/auth.js), which cascades every table keyed to the user.
export default function DeleteAccountModal({ getToken, onDeleted, onClose }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | deleting | error
  const panelRef = useModalA11y(onClose);

  function submit(e) {
    e.preventDefault();
    if (input.trim() !== CONFIRM_WORD) return;
    setStatus('deleting');
    fetch('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + getToken() },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        onDeleted();
      })
      .catch(() => setStatus('error'));
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
        aria-label="Delete account"
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="upgrade-title" style={{ color: '#EF4444' }}>
          Delete Account
        </h2>
        <p className="upgrade-desc">
          This permanently deletes your account, watchlist, alerts, and push subscriptions. This cannot be undone.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="delete-confirm-input" className="upgrade-desc" style={{ marginBottom: 8, display: 'block' }}>
            Type <strong>{CONFIRM_WORD}</strong> to confirm.
          </label>
          <input
            id="delete-confirm-input"
            className="auth-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ textAlign: 'center', marginBottom: 14 }}
          />
          {status === 'error' && (
            <p className="upgrade-desc" style={{ color: '#EF4444' }}>
              Couldn&apos;t delete your account — please try again.
            </p>
          )}
          <button
            className="upgrade-cta"
            type="submit"
            disabled={input.trim() !== CONFIRM_WORD || status === 'deleting'}
            style={{ background: '#EF4444', color: '#fff' }}
          >
            {status === 'deleting' ? 'Deleting…' : 'Permanently Delete My Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
