import React, { useState } from 'react';

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
  title = "Notifications aren't enabled",
  supportedDescription = 'Would you like to enable push notifications so you receive this result even when the app is closed? If not, it will still be saved in Notifications.',
  unsupportedDescription = 'Push notifications are not available in this browser. The item will still be saved and will appear in Notifications when you return. On iPhone, add the site to your Home Screen, open it there, and enable notifications.',
  enableLabel = 'Enable notifications',
  continueLabel = 'Continue without push',
  cancelLabel = 'Back',
  dir = 'ltr',
}) {
  const [enableError, setEnableError] = useState(null);

  async function handleEnable() {
    if (typeof onEnable !== 'function') {
      setEnableError('Notifications could not be enabled here. You can continue without push.');
      return;
    }
    setEnableError(null);
    try {
      await onEnable();
    } catch (error) {
      setEnableError(error instanceof Error ? error.message : 'Notifications could not be enabled.');
    }
  }

  return (
    <div className="notification-choice-overlay">
      <div className="notification-choice" role="dialog" aria-modal="true" aria-label={title} dir={dir}>
        <div className="notification-choice-icon" aria-hidden="true">
          🔔
        </div>
        <h2 className="notification-choice-title">{title}</h2>
        <p className="notification-choice-copy">{pushSupported ? supportedDescription : unsupportedDescription}</p>

        {(enableError || pushError) && (
          <p className="notification-choice-error" role="alert">
            {enableError || pushError}
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
              {pushBusy ? 'Enabling…' : enableLabel}
            </button>
          )}
          <button type="button" className="notification-choice-secondary" onClick={onContinue} disabled={actionBusy}>
            {actionBusy ? 'Saving…' : continueLabel}
          </button>
          <button type="button" className="notification-choice-cancel" onClick={onCancel} disabled={actionBusy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
