import React, { useEffect, useState } from 'react';
import useInstallPrompt from '../../hooks/useInstallPrompt';

export default function InstallPrompt() {
  const { canShow, isIOS, triggerInstall, dismiss } = useInstallPrompt();
  const [visible, setVisible] = useState(false);

  // Delay appearance slightly so it doesn't feel instant/jarring
  useEffect(() => {
    if (!canShow) return;
    const t = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(t);
  }, [canShow]);

  if (!visible) return null;

  function handleDismiss() {
    setVisible(false);
    dismiss();
  }

  function handleInstall() {
    if (isIOS) return; // iOS: button opens share sheet instructions inline
    triggerInstall().then(() => setVisible(false));
  }

  return (
    <div className="install-prompt" role="banner" aria-label="Add to Home Screen">
      <div className="install-prompt-icon" aria-hidden="true">
        <img src="/favicon.svg" alt="" width="36" height="36" />
      </div>

      <div className="install-prompt-body">
        <p className="install-prompt-title">Add Capital Flow to your home screen</p>
        {isIOS ? (
          <p className="install-prompt-sub">
            Tap the <strong>Share</strong> button <span aria-hidden="true">⎙</span> below, then
            &ldquo;<strong>Add to Home Screen</strong>&rdquo;
          </p>
        ) : (
          <p className="install-prompt-sub">One tap — instant access, no app store needed.</p>
        )}
      </div>

      {!isIOS && (
        <button className="install-prompt-cta" onClick={handleInstall}>
          Install
        </button>
      )}

      <button
        className="install-prompt-close"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
