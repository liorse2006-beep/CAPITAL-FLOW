/* eslint-disable react-refresh/only-export-components -- this is the application entrypoint, not a refreshable component module. */
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import App from './App';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UiLanguageContext, useUiLanguage } from './context/UiLanguageContext';
import { copyFor } from './utils/landingUiCopy';
import ErrorBoundary from './components/shared/ErrorBoundary';
import CookieConsent from './components/shared/CookieConsent';
import UpdateToast from './components/shared/UpdateToast';
import AccessibilityWidget from './components/shared/AccessibilityWidget';
import PublicLegalPage from './components/shared/PublicLegalPage';
import SplashLoader from './components/shared/SplashLoader';
import { hasCriticalFlow, installStaleChunkRecovery } from './utils/staleChunkRecovery';
import './sentry';
import './analytics';
import './styles/index.css';

// Count one site visit per browser session (not per reload) — a coarse
// "how many people opened the site" metric surfaced in the admin panel.
// sessionStorage-guarded so refreshes and SPA navigation don't inflate it;
// fire-and-forget, never blocks or surfaces an error to the visitor.
try {
  if (!sessionStorage.getItem('vs_visit_logged')) {
    sessionStorage.setItem('vs_visit_logged', '1');
    fetch('/api/visit', { method: 'POST' }).catch(function () {});
  }
} catch (_) {
  /* private mode with no storage — skip silently */
}

// Push notifications depend on an active service worker — App.jsx waits on
// navigator.serviceWorker.ready, which never resolves without a prior
// register() call. This was previously done in a now-unused legacy HTML
// file, so on a fresh browser (no leftover registration from that old file)
// "Enable Push Notifications" would hang forever.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then(function (reg) {
      // Only treat a controller handoff as a real "new version" event if a
      // controller already existed — the very first-ever visit also fires
      // controllerchange (no controller -> claimed), which isn't an update.
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          window.dispatchEvent(new CustomEvent('vs:sw-update-available'));
        });
      }
      // The browser checks for a new SW automatically on navigation, but an
      // SPA tab can stay open for hours without one — also check whenever
      // the tab regains focus so a long-lived session still notices deploys.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    })
    .catch(function () {});
}

function Root() {
  const language = useUiLanguage();
  const { isLoading, user, authLoadError, pendingGoogleToken } = useAuth();
  const { pathname } = useLocation();
  useEffect(
    () =>
      installStaleChunkRecovery({
        canReload: () => !pendingGoogleToken && !hasCriticalFlow(),
      }),
    [pendingGoogleToken]
  );
  if (pathname === '/policy' || pathname === '/accessibility') {
    return <PublicLegalPage path={pathname} />;
  }

  if (isLoading) {
    return <SplashLoader label={copyFor(language, 'Loading…')} />;
  }

  if (authLoadError) {
    return (
      <div className="startup-error-screen">
        <div className="startup-error-card">
          <div className="logo-mark" aria-hidden="true">
            <div className="logo-bar" />
            <div className="logo-bar" />
            <div className="logo-bar" />
          </div>
          <h1>{copyFor(language, "We couldn't load Capital Flow")}</h1>
          <p>
            {copyFor(language, 'The service is temporarily unavailable. Your session is saved and you can try again.')}
          </p>
          <button className="upgrade-cta" onClick={() => window.location.reload()}>
            {copyFor(language, 'Try again')}
          </button>
        </div>
      </div>
    );
  }

  // Remount account-scoped UI on login/logout so local notification and
  // watchlist state can never bleed from one account into another.
  return <App key={user ? String(user.id) : 'guest'} />;
}

function SiteLanguageFrame() {
  const { pathname } = useLocation();
  // The whole product is Hebrew and laid out right-to-left. Tickers, prices
  // and numbers keep their own left-to-right runs (dir="ltr" / <bdi>).
  const language = 'he';
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = 'rtl';
  }, [pathname]);
  return (
    <UiLanguageContext.Provider value={language}>
      <Root />
      <CookieConsent />
      <UpdateToast />
      <AccessibilityWidget />
    </UiLanguageContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <SiteLanguageFrame />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
