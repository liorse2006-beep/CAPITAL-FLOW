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
        aria-label="Send feedback"
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {status === 'sent' ? (
          <>
            <h2 className="upgrade-title">Thanks!</h2>
            <p className="upgrade-desc">Your feedback helps shape what we build next.</p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 className="upgrade-title">Send Feedback</h2>
            <p className="upgrade-desc">Found a bug, or have an idea? Tell us — we read every message.</p>
            <label htmlFor="feedback-message" className="sr-only">
              Your feedback
            </label>
            <textarea
              id="feedback-message"
              className="auth-input"
              rows={4}
              placeholder="What's on your mind?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ resize: 'vertical', marginBottom: 10, fontFamily: 'inherit' }}
            />
            {!user && (
              <>
                <label htmlFor="feedback-email" className="sr-only">
                  Your email (optional)
                </label>
                <input
                  id="feedback-email"
                  className="auth-input"
                  type="email"
                  placeholder="Your email (optional, so we can reply)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ marginBottom: 14 }}
                />
              </>
            )}
            {status === 'error' && (
              <p className="upgrade-desc" style={{ color: 'var(--red, #EF4444)' }}>
                Couldn&apos;t send — please try again.
              </p>
            )}
            <button className="upgrade-cta" type="submit" disabled={status === 'sending' || !message.trim()}>
              {status === 'sending' ? 'Sending…' : 'Send'}
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
      <button className="feedback-fab" onClick={() => setOpen(true)} title="Send feedback" aria-label="Send feedback">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && <FeedbackModal user={user} onClose={() => setOpen(false)} />}
    </>
  );
}
