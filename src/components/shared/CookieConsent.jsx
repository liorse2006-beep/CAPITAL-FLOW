import { useState } from 'react';
import { hasAnswered, giveConsent, revokeConsent } from '../../analytics';

export default function CookieConsent() {
  const [visible, setVisible] = useState(() => !hasAnswered());

  if (!visible) return null;

  function handleAccept() {
    giveConsent();
    setVisible(false);
  }

  function handleDecline() {
    revokeConsent();
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="הסכמה לשימוש בעוגיות"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--border-strong)',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
        direction: 'rtl',
      }}
    >
      <p style={{ color: 'var(--text-1)', fontSize: 13, lineHeight: 1.5, flex: '1 1 220px', margin: 0 }}>
        אנחנו משתמשים בנתוני שימוש אנונימיים (PostHog) כדי לשפר את האפליקציה.{' '}
        <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          מדיניות פרטיות
        </a>
      </p>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleDecline}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-1)',
            borderRadius: 'var(--radius)',
            padding: '7px 16px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          דחה
        </button>
        <button
          onClick={handleAccept}
          style={{
            background: 'var(--accent)',
            border: 'none',
            color: '#0a0a0a',
            borderRadius: 'var(--radius)',
            padding: '7px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          אשר
        </button>
      </div>
    </div>
  );
}
