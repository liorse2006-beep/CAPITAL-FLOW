import React from 'react';

// Blocks the app until a pilot tester accepts the confidentiality terms,
// then shows a small traceable watermark for the rest of the session —
// useful if a screenshot of the (still-confidential) product ever leaks.
export default function PilotGate({ user, onAccept, onSignOut }) {
  if (!user || !user.is_pilot) return null;

  if (!user.pilot_terms_accepted_at) {
    return (
      <div className="upgrade-overlay" style={{ zIndex: 10000 }}>
        <div className="upgrade-modal" style={{ maxWidth: 460 }}>
          <h2 className="upgrade-title">תוכנית פיילוט — גישה אישית</h2>
          <p className="upgrade-desc" style={{ textAlign: 'start', lineHeight: 1.6 }}>
            קיבלת גישה מוקדמת ל־Capital Flow במסגרת פיילוט מוגבל. הגישה אישית לחשבונך — אין לשתף פרטי התחברות. יש לשמור
            בסודיות את המוצר, העיצוב והנתונים. תודה על ההתנסות ועל המשוב.
          </p>
          <button className="upgrade-cta" onClick={onAccept}>
            אני מסכים — המשך
          </button>
          <p className="upgrade-sub">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSignOut();
              }}
            >
              התנתקות
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 10,
        right: 12,
        zIndex: 9999,
        fontSize: 10,
        fontFamily: 'var(--mono)',
        letterSpacing: '0.04em',
        color: 'rgba(168,85,247,0.55)',
        background: 'rgba(168,85,247,0.08)',
        border: '1px solid rgba(168,85,247,0.2)',
        borderRadius: 100,
        padding: '3px 10px',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {'פיילוט · גישה אישית · ' + user.email}
    </div>
  );
}
