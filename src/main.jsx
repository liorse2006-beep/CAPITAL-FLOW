import React, { useState, lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider, useAuth } from './context/AuthContext'
import './styles/index.css'

// Split out — OnboardingQuiz is only ever seen by first-time visitors
// (returning users skip straight past it via the vs_quiz_done flag), and
// AuthModal is only needed once someone actually opens it. Neither belongs
// in the bundle every visitor downloads up front.
const OnboardingQuiz = lazy(() => import('./pages/OnboardingQuiz'))
const AuthModal = lazy(() => import('./components/Auth/AuthModal'))

// Push notifications depend on an active service worker — App.jsx waits on
// navigator.serviceWorker.ready, which never resolves without a prior
// register() call. This was previously done in a now-unused legacy HTML
// file, so on a fresh browser (no leftover registration from that old file)
// "Enable Push Notifications" would hang forever.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function() {})
}

function Root() {
  const { user, isLoading } = useAuth()
  const [quizDone, setQuizDone] = useState(() => !!localStorage.getItem('vs_quiz_done'))
  const [showAuthModal, setShowAuthModal] = useState(false)

  function handleQuizComplete() {
    setQuizDone(true)
    if (!user) setShowAuthModal(true)
  }

  const loadingScreen = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0A0A0A' }}>
      <div style={{ color: '#F59E0B', fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.1em' }}>Loading…</div>
    </div>
  )

  if (isLoading) {
    return loadingScreen
  }

  if (!quizDone) {
    return (
      <Suspense fallback={loadingScreen}>
        <OnboardingQuiz onComplete={handleQuizComplete} />
      </Suspense>
    )
  }

  return (
    <>
      <App />
      {showAuthModal && !user && (
        <Suspense fallback={null}>
          <AuthModal onClose={() => setShowAuthModal(false)} />
        </Suspense>
      )}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>
)
