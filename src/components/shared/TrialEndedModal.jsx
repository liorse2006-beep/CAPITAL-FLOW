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
// experienced and opens the full plan comparison only after the user chooses
// to continue.
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
        aria-label="תקופת הניסיון הסתיימה"
        dir="rtl"
        lang="he"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="סגירה">
          ×
        </button>

        <div className="trial-ended-topline">
          <div className="trial-ended-brand">
            <img src="/icon-192.png" alt="" />
            <span>CAPITAL FLOW</span>
          </div>
          <span className="trial-ended-status">
            <span className="trial-ended-status-dot" />
            הניסיון לשבעה ימים הסתיים
          </span>
        </div>

        <div className="trial-ended-hero">
          <div className="trial-ended-eyebrow">המניות וההגדרות שלך נשמרו</div>
          <h2 className="trial-ended-title">ממשיכים גם אחרי הניסיון.</h2>
        </div>

        <div className="trial-ended-proof" aria-label="תכונות תקופת הניסיון">
          <div className="trial-ended-proof-heading">הכלים שהיו זמינים בניסיון</div>
          <div className="trial-ended-proof-grid">
            <div className="trial-ended-proof-item">
              <span className="trial-ended-proof-icon">
                <SignalIcon type="scan" />
              </span>
              <span>
                <strong>גישה לסריקות</strong>
                <small>זיהוי תנועות מעניינות בשוק</small>
              </span>
            </div>
            <div className="trial-ended-proof-item">
              <span className="trial-ended-proof-icon">
                <SignalIcon type="alert" />
              </span>
              <span>
                <strong>התראות למעקב</strong>
                <small>פוש, רשימת מעקב וסריקות מתוזמנות</small>
              </span>
            </div>
            <div className="trial-ended-proof-item">
              <span className="trial-ended-proof-icon">
                <SignalIcon type="context" />
              </span>
              <span>
                <strong>מידע להמשך מחקר</strong>
                <small>נתונים פיננסיים, גרפים וסקירת שוק</small>
              </span>
            </div>
          </div>
        </div>

        <div className="trial-ended-lifetime" aria-label="תשלום חד־פעמי וגישה ללא הגבלת זמן">
          <span className="trial-ended-lifetime-icon" aria-hidden="true">
            ∞
          </span>
          <span>
            <strong>תשלום חד־פעמי · גישה ללא הגבלת זמן</strong>
            <small>בלי חיוב חודשי. ההגדרות שלך נשמרות.</small>
          </span>
        </div>

        <button className="upgrade-cta trial-ended-primary" onClick={onUpgrade}>
          <span>למסלולים ולהמשך סריקה</span>
          <ArrowIcon />
        </button>
        <button className="trial-ended-secondary" onClick={onClose}>
          אולי מאוחר יותר
        </button>

        <div className="trial-ended-trust">
          <span>תשלום מאובטח</span>
          <span className="trial-ended-trust-separator" />
          <span>Apple Pay ו־Google Pay במכשירים נתמכים</span>
          <span className="trial-ended-trust-separator" />
          <span>ללא חיוב חוזר</span>
        </div>
      </div>
    </div>
  );
}
