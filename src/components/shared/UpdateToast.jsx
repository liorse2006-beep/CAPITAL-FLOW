import { useUiLanguage } from '../../context/UiLanguageContext';
import { copyFor } from '../../utils/landingUiCopy';
import React, { useEffect, useState } from 'react';

// The service worker (public/sw.js) calls skipWaiting()+clients.claim() the
// moment a new version installs, so by the time this page could know about
// it, the new SW has already taken over — there's no "waiting" version to
// ask the user to activate. All we can do is notice the takeover (via the
// 'vs:sw-update-available' event dispatched from main.jsx) and let the user
// choose when to reload into it, rather than yanking the page out from
// under them mid-action.
export default function UpdateToast() {
  const language = useUiLanguage();
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onUpdate() {
      setShow(true);
    }
    window.addEventListener('vs:sw-update-available', onUpdate);
    return () => window.removeEventListener('vs:sw-update-available', onUpdate);
  }, []);

  if (!show) return null;

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <span className="update-toast-msg">{copyFor(language, 'A new version of Capital Flow is available')}</span>
      <button className="update-toast-btn" onClick={() => window.location.reload()}>
        {copyFor(language, '\n        Refresh\n      ')}
      </button>
      <button className="update-toast-close" onClick={() => setShow(false)} aria-label={copyFor(language, 'Close')}>
        ✕
      </button>
    </div>
  );
}
