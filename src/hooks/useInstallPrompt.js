import { useState, useEffect } from 'react';

const STORAGE_KEY = 'vs_install_dismissed';

export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already dismissed or installed before
    if (localStorage.getItem(STORAGE_KEY)) {
      setDismissed(true);
      return;
    }

    // Already running as installed PWA
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (standalone) {
      setIsStandalone(true);
      return;
    }

    // Detect iOS (Safari doesn't fire beforeinstallprompt)
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    // Chrome/Edge/Android: capture the native install event
    function handleBeforeInstall(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  async function triggerInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') dismiss();
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  }

  // Show if: not dismissed, not standalone, and either got native prompt OR is iOS
  const canShow = !dismissed && !isStandalone && (deferredPrompt !== null || isIOS);

  return { canShow, isIOS, triggerInstall, dismiss };
}
