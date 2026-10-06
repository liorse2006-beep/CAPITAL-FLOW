import React, { useEffect, useRef, useState } from 'react';
import { getTurnstileSiteKey, TURNSTILE_LOAD_TIMEOUT_MS } from './turnstileConfig';

const SCRIPT_ID = 'cf-turnstile-script';

export default function Turnstile({ onVerify, onExpire, resetKey = 0, siteKey = getTurnstileSiteKey() }) {
  const containerRef = useRef(null);
  const callbacksRef = useRef({ onVerify, onExpire });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    callbacksRef.current = { onVerify, onExpire };
  }, [onVerify, onExpire]);

  useEffect(() => {
    let disposed = false;
    let widgetId = null;
    let script;
    let poll;
    let timeout;
    let settled = false;

    function stopWaiting() {
      clearInterval(poll);
      clearTimeout(timeout);
    }

    function invalidate(nextStatus) {
      if (disposed) return;
      callbacksRef.current.onExpire();
      setStatus(nextStatus);
    }

    function fail() {
      if (disposed || settled) return;
      settled = true;
      stopWaiting();
      if (script) script.dataset.loadFailed = 'true';
      invalidate('error');
    }

    function renderWidget() {
      if (disposed || settled || !window.turnstile || !containerRef.current) return;
      settled = true;
      stopWaiting();
      try {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: window.matchMedia?.('(max-width: 380px)').matches ? 'compact' : 'flexible',
          callback: (token) => {
            if (disposed) return;
            setStatus('verified');
            callbacksRef.current.onVerify(token);
          },
          'error-callback': () => {
            invalidate('error');
            return true;
          },
          'expired-callback': () => invalidate('expired'),
          'timeout-callback': () => invalidate('expired'),
        });
      } catch {
        invalidate('error');
      }
    }

    invalidate('loading');
    if (!siteKey) {
      invalidate('unconfigured');
      return () => {
        disposed = true;
      };
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      script = document.getElementById(SCRIPT_ID);
      // A failed script element will never fire another load event. Replace
      // it on an explicit retry, rather than polling the dead element forever.
      if (script?.dataset.loadFailed === 'true') {
        script.remove();
        script = null;
      }
      const needsAppend = !script;
      if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
      }
      script.addEventListener('load', renderWidget);
      script.addEventListener('error', fail);
      poll = setInterval(renderWidget, 100);
      timeout = setTimeout(fail, TURNSTILE_LOAD_TIMEOUT_MS);
      if (needsAppend) document.head.appendChild(script);
    }

    return () => {
      disposed = true;
      stopWaiting();
      script?.removeEventListener('load', renderWidget);
      script?.removeEventListener('error', fail);
      if (widgetId != null && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey, attempt, resetKey]);

  const failed = status === 'error' || status === 'expired';
  return (
    <div className="auth-verification">
      <div ref={containerRef} />
      {status === 'loading' && <p role="status">Loading verification…</p>}
      {status === 'unconfigured' && (
        <p role="alert">Email sign-up is temporarily unavailable. Please try again later.</p>
      )}
      {failed && (
        <div role="alert">
          <p>
            {status === 'expired'
              ? 'Verification expired. Please try again.'
              : 'Verification could not connect. Please try again.'}
          </p>
          <button type="button" className="auth-link-btn" onClick={() => setAttempt((value) => value + 1)}>
            Retry verification
          </button>
        </div>
      )}
    </div>
  );
}
