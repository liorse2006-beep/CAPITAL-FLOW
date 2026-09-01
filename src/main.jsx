import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import App from './App';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/shared/ErrorBoundary';
import CookieConsent from './components/shared/CookieConsent';
import UpdateToast from './components/shared/UpdateToast';
import AccessibilityWidget from './components/shared/AccessibilityWidget';
import ScanLoader from './components/shared/ScanLoader';
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

// Same animated ticker-tape loader used during scans, reused here for the
// (rare, but possible during a transient cold start) case where the initial /api/auth/me
// check is slow because the server was asleep. Imported eagerly, not lazily
// — ScannerPage already imports it statically, so it's in the main bundle
// regardless; a dynamic import() here would just add an ineffective split.
const COLD_START_MESSAGES = [
  'Waking up the server…',
  'This can take up to 30 seconds on the first load of the day',
  'Almost there…',
];

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
  const { isLoading, user, authLoadError } = useAuth();
  // Most loads resolve in well under a second — only switch to the fuller
  // animated "waking up" screen once the wait has gone on long enough that
  // it's plausibly a cold Render instance, not a flash on every visit.
  const [showColdStart, setShowColdStart] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setShowColdStart(false);
      return;
    }
    const t = setTimeout(() => setShowColdStart(true), 1200);
    return () => clearTimeout(t);
  }, [isLoading]);

  const plainLoadingScreen = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0A0A0A',
      }}
    >
      <div style={{ color: '#F59E0B', fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.1em' }}>Loading…</div>
    </div>
  );

  const loadingScreen = showColdStart ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0A0A0A',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 340 }}>
        <ScanLoader label="Capital Flow" statusMessages={COLD_START_MESSAGES} />
      </div>
    </div>
  ) : (
    plainLoadingScreen
  );

  if (isLoading) {
    return loadingScreen;
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
          <h1>We couldn&apos;t reach Capital Flow</h1>
          <p>The server may be waking up or temporarily unavailable. Your session is still saved.</p>
          <button className="upgrade-cta" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Remount account-scoped UI on login/logout so local notification and
  // watchlist state can never bleed from one account into another.
  return <App key={user ? String(user.id) : 'guest'} />;
}

// The landing page (App.jsx's own logged-out "/" route) has its own
// complete, self-contained design — the app-wide accessibility widget
// doesn't belong floating on top of it. Only suppressed there; every real
// app screen still gets it.
function ConditionalAccessibilityWidget() {
  const { user } = useAuth();
  const location = useLocation();
  if (location.pathname === '/' && !user) return null;
  return <AccessibilityWidget />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Root />
          <CookieConsent />
          <UpdateToast />
          <ConditionalAccessibilityWidget />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
