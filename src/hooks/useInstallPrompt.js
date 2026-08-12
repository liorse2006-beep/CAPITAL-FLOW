import { useState, useEffect } from 'react';

const STORAGE_KEY = 'vs_install_dismissed';

export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) return;

    // Already running as installed PWA
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (standalone) {
      setIsStandalone(true);
      return;
    }

    // Detect iOS (Safari doesn't fire beforeinstallprompt)
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    // The browser can fire beforeinstallprompt before this effect ever runs
    // (e.g. a slow bundle load on a new device) — index.html captures it as
    // early as possible into window.__vsDeferredInstallPrompt so it isn't
    // lost. Pick that up first, then still listen live for it firing later.
    if (window.__vsDeferredInstallPrompt) {
      setDeferredPrompt(window.__vsDeferredInstallPrompt);
    }

    // Chrome/Edge/Android: capture the native install event
    function handleBeforeInstall(e) {
      e.preventDefault();
      window.__vsDeferredInstallPrompt = e;
      setDeferredPrompt(e);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, [dismissed]);

  async function triggerInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    window.__vsDeferredInstallPrompt = null; // a BeforeInstallPromptEvent can only be used once
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
