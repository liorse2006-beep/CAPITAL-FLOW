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
        {isIOS ? (
          <>
            <p className="install-prompt-title">Add to your home screen for faster access</p>
            <div className="install-prompt-steps">
              <span className="install-prompt-step">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v13" />
                  <path d="M7 8l5-5 5 5" />
                  <rect x="5" y="13" width="14" height="8" rx="2" />
                </svg>
                Share
              </span>
              <svg className="install-prompt-step-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <span className="install-prompt-step">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                Add Home
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="install-prompt-title">Add Capital Flow to your home screen</p>
            <p className="install-prompt-sub">One tap — instant access, no app store needed.</p>
          </>
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
