import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { friendlyError } from '../../utils/format';

/**
 * Ask for an explicit delivery choice at the moment an alert or schedule is
 * being saved. Push is a delivery enhancement, not the durable source of the
 * alert itself: callers can still persist the alert and show it in-app.
 */
export default function NotificationChoice({
  pushSupported,
  pushBusy,
  pushError,
  onEnable,
  onContinue,
  onCancel,
  actionBusy = false,
  title = 'ההתראות אינן מופעלות',
  supportedDescription = 'להפעיל התראות גם כשהאפליקציה סגורה? אפשר להמשיך בלי — התוצאה תישמר באפליקציה.',
  unsupportedDescription = 'באייפון: שיתוף ← הוספה למסך הבית. פתח משם והפעל התראות. בינתיים התוצאה תישמר באפליקציה.',
  enableLabel = 'הפעלת התראות',
  continueLabel = 'המשך בלי התראות למכשיר',
  cancelLabel = 'חזרה',
  dir = 'rtl',
}) {
  const panelRef = useModalA11y(onCancel);
  const [enableError, setEnableError] = useState(null);

  async function handleEnable() {
    if (typeof onEnable !== 'function') {
      setEnableError('לא הצלחנו להפעיל התראות כאן. אפשר להמשיך בלי התראות למכשיר.');
      return;
    }
    setEnableError(null);
    try {
      await onEnable();
    } catch (error) {
      setEnableError(friendlyError(error?.message));
    }
  }

  return (
    <div className="notification-choice-overlay">
      <div
        ref={panelRef}
        tabIndex={-1}
        className="notification-choice"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir={dir}
      >
        <div className="notification-choice-icon" aria-hidden="true">
          🔔
        </div>
        <h2 className="notification-choice-title">{title}</h2>
        <p className="notification-choice-copy">{pushSupported ? supportedDescription : unsupportedDescription}</p>

        {(enableError || pushError) && (
          <p className="notification-choice-error" role="alert">
            {enableError || friendlyError(pushError)}
          </p>
        )}

        <div className="notification-choice-actions">
          {pushSupported && (
            <button
              type="button"
              className="notification-choice-primary"
              onClick={handleEnable}
              disabled={pushBusy || actionBusy}
            >
              {pushBusy ? 'מפעילים…' : enableLabel}
            </button>
          )}
          <button type="button" className="notification-choice-secondary" onClick={onContinue} disabled={actionBusy}>
            {actionBusy ? 'שומרים…' : continueLabel}
          </button>
          <button type="button" className="notification-choice-cancel" onClick={onCancel} disabled={actionBusy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
