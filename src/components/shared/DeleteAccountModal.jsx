import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import useAccountOperation from '../../hooks/useAccountOperation';

const CONFIRM_WORD = 'DELETE';

// Irreversible — requires typing a confirmation word (not just a click) so
// this can't be triggered by a stray tap. Calls DELETE /api/auth/account
// (server/routes/auth.js), which cascades every table keyed to the user.
export default function DeleteAccountModal({ getToken, onDeleted, onClose }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | deleting | error
  const panelRef = useModalA11y(onClose);
  const beginOperation = useAccountOperation(getToken);

  function submit(e) {
    e.preventDefault();
    if (input.trim() !== CONFIRM_WORD) return;
    const operation = beginOperation('delete-account');
    if (!operation) return;
    setStatus('deleting');
    fetch('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + operation.token },
      signal: operation.signal,
    })
      .then((r) => {
        if (!operation.canCommit()) return;
        if (!r.ok) throw new Error('Failed');
        onDeleted();
      })
      .catch(() => {
        if (operation.isCurrent()) setStatus('error');
      })
      .finally(operation.finish);
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
        aria-label="מחיקת חשבון"
      >
        <button className="upgrade-close" onClick={onClose} aria-label="סגירה">
          ×
        </button>
        <h2 className="upgrade-title" style={{ color: '#EF4444' }}>
          מחיקת חשבון
        </h2>
        <p className="upgrade-desc">
          החשבון, רשימת המעקב, ההתראות וחיבורי ההתראות יימחקו לצמיתות. לא ניתן לבטל את הפעולה.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="delete-confirm-input" className="upgrade-desc" style={{ marginBottom: 8, display: 'block' }}>
            יש להקליד <strong dir="ltr">{CONFIRM_WORD}</strong> לאישור.
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
              לא הצלחנו לאשר שהחשבון נמחק. יש להתחבר שוב ולבדוק לפני ניסיון נוסף.
            </p>
          )}
          <button
            className="upgrade-cta"
            type="submit"
            disabled={input.trim() !== CONFIRM_WORD || status === 'deleting'}
            style={{ background: '#EF4444', color: '#fff' }}
          >
            {status === 'deleting' ? 'מוחקים…' : 'מחיקת החשבון שלי לצמיתות'}
          </button>
        </form>
      </div>
    </div>
  );
}
