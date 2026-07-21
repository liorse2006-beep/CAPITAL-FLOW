import React, { useState, lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/shared/ErrorBoundary';
import CookieConsent from './components/shared/CookieConsent';
import './sentry';
import './analytics';
import './styles/index.css';

// Split out — OnboardingQuiz is only ever seen by first-time visitors
// (returning users skip straight past it via the vs_quiz_done flag), and
// doesn't belong in the bundle every visitor downloads up front.
const OnboardingQuiz = lazy(() => import('./pages/OnboardingQuiz'));

// Push notifications depend on an active service worker — App.jsx waits on
// navigator.serviceWorker.ready, which never resolves without a prior
// register() call. This was previously done in a now-unused legacy HTML
// file, so on a fresh browser (no leftover registration from that old file)
// "Enable Push Notifications" would hang forever.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
}

function Root() {
  const { isLoading } = useAuth();
  // A Whop checkout redirect (?status=success|error) must always reach
  // App.jsx, which is the only place that cleans the URL, shows the
  // "Payment received" toast, and refreshes the user's tier — none of
  // that runs if this load gets routed to the onboarding quiz instead.
  // vs_quiz_done can only be missing here for an existing, already-paying
  // user if their localStorage was wiped between clicking Upgrade and
  // Whop redirecting back, but treat that as unrecoverable-by-quiz-gate
  // regardless: showing "what kind of trader are you?" instead of a
  // payment confirmation would be broken UX even if it were rare.
  const [quizDone, setQuizDone] = useState(
    () => !!localStorage.getItem('vs_quiz_done') || new URLSearchParams(window.location.search).has('status')
  );

  function handleQuizComplete() {
    setQuizDone(true);
  }

  const loadingScreen = (
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

  if (isLoading) {
    return loadingScreen;
  }

  if (!quizDone) {
    return (
      <Suspense fallback={loadingScreen}>
        <OnboardingQuiz onComplete={handleQuizComplete} />
      </Suspense>
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Root />
          <CookieConsent />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
