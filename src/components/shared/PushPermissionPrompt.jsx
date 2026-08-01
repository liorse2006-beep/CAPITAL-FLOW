import React, { useEffect, useState } from 'react';
import usePushSubscription from '../../hooks/usePushSubscription';

export default function PushPermissionPrompt({ user, canNotify }) {
  const { pushSupported, pushBusy, enablePush } = usePushSubscription();
  const [dismissed, setDismissed] = useState(false);

  // Everyone with Elite feature access gets asked — that includes every
  // account during its 7-day free trial, not just paid Elite. Fall back to
  // the raw tier check if the parent didn't pass canNotify (e.g. in tests).
  const hasAccess = canNotify != null ? !!canNotify : !!(user && (user.tier === 'elite' || user.elite_access));
  const storageKey = user ? 'vs_push_prompted_' + user.id : null;
  const [alreadyPrompted, setAlreadyPrompted] = useState(true);

  useEffect(() => {
    if (!storageKey) return;
    setAlreadyPrompted(!!localStorage.getItem(storageKey));
  }, [storageKey]);

  const canShow =
    hasAccess &&
    pushSupported &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'default' &&
    !alreadyPrompted &&
    !dismissed;

  if (!canShow) return null;

  function markPrompted() {
    if (storageKey) localStorage.setItem(storageKey, '1');
    setDismissed(true);
  }

  function handleEnable() {
    enablePush().catch(() => {}).finally(markPrompted);
  }

  return (
    <div className="upgrade-overlay" onClick={markPrompted} role="dialog" aria-modal="true" aria-label="Enable push notifications">
      <div className="push-prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="push-prompt-glow" aria-hidden="true" />

        <div className="push-prompt-icon-wrap">
          <div className="push-prompt-icon-ring">
            <span className="push-prompt-bell" role="img" aria-label="bell">🔔</span>
          </div>
        </div>

        <h2 className="push-prompt-headline">Never miss a move</h2>
        <p className="push-prompt-subtext">
          Get notified the instant a stock crosses your threshold —{' '}
          <strong>even with the app closed.</strong> Scheduled scans send you results automatically.
        </p>

        <button
          className="push-prompt-enable-btn"
          onClick={handleEnable}
          disabled={pushBusy}
        >
          {pushBusy ? 'Enabling…' : '🔔  Enable Notifications'}
        </button>

        <button className="push-prompt-dismiss" onClick={markPrompted}>
          Not now — I&apos;ll enable later
        </button>
      </div>
    </div>
  );
}
