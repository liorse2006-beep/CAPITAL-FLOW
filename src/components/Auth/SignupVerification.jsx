import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import 'altcha/external';
import 'altcha/altcha.css';
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker';

// Vite emits a same-origin worker file. No CDN, blob worker, third-party
// connection or relaxed script policy is needed for verification.
window.$altcha.algorithms.set('PBKDF2/SHA-256', () => new Pbkdf2Worker());

// The SDK exposes its methods only after its asynchronous `load` event.
// Initial configuration must be supplied as attributes, before that event.
const configuration = JSON.stringify({
  challenge: '/api/auth/signup-challenge',
  credentials: 'same-origin',
  auto: 'onload',
  workers: 2,
  language: 'en',
  hideLogo: true,
  hideFooter: true,
  humanInteractionSignature: false,
  timeout: 25000,
});

export default function SignupVerification({ onVerify, onExpire, resetKey = 0 }) {
  const widgetRef = useRef(null);
  const callbacksRef = useRef({ onVerify, onExpire });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    callbacksRef.current = { onVerify, onExpire };
  }, [onVerify, onExpire]);

  useLayoutEffect(() => {
    const widget = widgetRef.current;
    let disposed = false;
    const stateChanged = (event) => {
      if (disposed) return;
      const state = event.detail?.state;
      if (state !== 'verified') callbacksRef.current.onExpire();
      if (state === 'error' || state === 'expired') setStatus('error');
      else if (state === 'verifying' || state === 'unverified') setStatus('loading');
    };
    const verified = (event) => {
      if (disposed) return;
      const payload = event.detail?.payload;
      if (typeof payload !== 'string' || !payload) return;
      setStatus('verified');
      callbacksRef.current.onVerify(`altcha:${payload}`);
    };
    widget.addEventListener('statechange', stateChanged);
    widget.addEventListener('verified', verified);
    const timeout = setTimeout(() => {
      if (!disposed && widget.getState?.() !== 'verified') {
        callbacksRef.current.onExpire();
        setStatus('error');
      }
    }, 30000);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      widget.removeEventListener('statechange', stateChanged);
      widget.removeEventListener('verified', verified);
      widget.reset?.();
    };
  }, [attempt, resetKey]);

  return (
    <div className="auth-verification">
      <altcha-widget ref={widgetRef} key={`${resetKey}-${attempt}`} configuration={configuration} />
      {status === 'loading' && <p role="status">Verifying…</p>}
      {status === 'error' && (
        <div role="alert">
          <p>Could not verify. Please try again.</p>
          <button
            type="button"
            className="auth-link-btn"
            onClick={() => {
              setStatus('loading');
              setAttempt((value) => value + 1);
            }}
          >
            Retry verification
          </button>
        </div>
      )}
    </div>
  );
}
