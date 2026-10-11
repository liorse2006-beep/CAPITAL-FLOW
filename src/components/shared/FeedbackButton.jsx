import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { track } from '../../analytics';
import useModalA11y from '../../hooks/useModalA11y';

function FeedbackModal({ user, onClose }) {
  const location = useLocation();
  const { getToken } = useAuth();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const panelRef = useModalA11y(onClose);

  function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus('sending');
    const token = getToken();
    fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({ message: message.trim(), email: email.trim(), page: location.pathname }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        track('feedback_submitted', { page: location.pathname });
        setStatus('sent');
        setMessage('');
        setTimeout(onClose, 1800);
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
        aria-label="שליחת משוב"
      >
        <button className="upgrade-close" onClick={onClose} aria-label="סגירה">
          ×
        </button>
        {status === 'sent' ? (
          <>
            <h2 className="upgrade-title">תודה!</h2>
            <p className="upgrade-desc">המשוב שלך עוזר לנו לשפר את המוצר.</p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 className="upgrade-title">שליחת משוב</h2>
            <p className="upgrade-desc">מצאת תקלה או שיש לך רעיון? נשמח לשמוע.</p>
            <label htmlFor="feedback-message" className="sr-only">
              המשוב שלך
            </label>
            <textarea
              id="feedback-message"
              className="auth-input"
              rows={4}
              placeholder="מה תרצה לשתף?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ resize: 'vertical', marginBottom: 10, fontFamily: 'inherit' }}
            />
            {!user && (
              <>
                <label htmlFor="feedback-email" className="sr-only">
                  המייל שלך (לא חובה)
                </label>
                <input
                  id="feedback-email"
                  className="auth-input"
                  type="email"
                  placeholder="המייל שלך (לא חובה, כדי שנוכל להשיב)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ marginBottom: 14 }}
                />
              </>
            )}
            {status === 'error' && (
              <p className="upgrade-desc" style={{ color: 'var(--red, #EF4444)' }}>
                לא הצלחנו לשלוח. אפשר לנסות שוב.
              </p>
            )}
            <button className="upgrade-cta" type="submit" disabled={status === 'sending' || !message.trim()}>
              {status === 'sending' ? 'שולחים…' : 'שליחה'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// Floating feedback entry point, always mounted — the in-app equivalent of
// the roadmap's "in-app feedback button" item. Submits to POST /api/feedback
// (server/routes/feedback.js), visible to admins on /admin.
export default function FeedbackButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="feedback-fab" onClick={() => setOpen(true)} title="שליחת משוב" aria-label="שליחת משוב">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && <FeedbackModal user={user} onClose={() => setOpen(false)} />}
    </>
  );
}
