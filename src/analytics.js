// Product analytics — fully opt-in, mirrors the src/sentry.js pattern. With
// no VITE_POSTHOG_KEY set at build time, the posthog-js SDK (~150kB) is
// never even fetched, so local dev and any environment without a key pay
// zero bundle or network cost — same "no-op without a key" contract as
// src/sentry.js, just done via dynamic import instead of tree-shaking,
// since the SDK's side-effecting init() can't be shaken out at build time.
const KEY = import.meta.env.VITE_POSTHOG_KEY || '';
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
const enabled = !!KEY;

const CONSENT_KEY = 'cf_analytics_consent';
let suspended = false;
let operationEpoch = 0;
let loadedPosthog = null;
let resetPending = false;

function readConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

export function hasConsented() {
  return !suspended && readConsent() === 'true';
}

export function hasAnswered() {
  return readConsent() !== null;
}

function safely(action) {
  try {
    action();
  } catch {
    // Optional statistics must never prevent authentication or navigation.
  }
}

function stopCapturing() {
  suspended = true;
  operationEpoch += 1;
  resetPending = true;
  window.removeEventListener('storage', onConsentStorage);
  if (loadedPosthog) {
    safely(() => loadedPosthog.opt_out_capturing());
    safely(() => loadedPosthog.reset());
    resetPending = false;
  }
}

function onConsentStorage(event) {
  if ((event.key === CONSENT_KEY || event.key === null) && !hasConsented()) stopCapturing();
}

let posthogPromise = null;
function loadPosthog() {
  if (!enabled || !hasConsented()) return Promise.resolve(null);
  if (!posthogPromise) {
    posthogPromise = import('posthog-js')
      .then((mod) => {
        // Consent may have been revoked while the optional bundle was loading.
        if (!hasConsented()) return null;
        const posthog = mod.default;
        posthog.init(KEY, {
          api_host: HOST,
          // Page views are tracked manually on route change (App.jsx watches
          // location.pathname), not via posthog's own history-API patching —
          // this app already has React Router doing that job and
          // double-tracking would skew funnels.
          capture_pageview: false,
          capture_pageleave: true,
          opt_out_capturing_by_default: true,
          opt_out_persistence_by_default: true,
        });
        loadedPosthog = posthog;
        if (resetPending) {
          posthog.reset();
          resetPending = false;
        }
        if (!hasConsented()) {
          stopCapturing();
          return null;
        }
        posthog.opt_in_capturing({ captureEventName: false });
        window.addEventListener('storage', onConsentStorage);
        return posthog;
      })
      .catch(() => null)
      .then((posthog) => {
        if (!posthog) posthogPromise = null;
        return posthog;
      });
  }
  return posthogPromise;
}

// Only load on startup if the user has already consented
if (enabled && hasConsented()) loadPosthog();

export function giveConsent() {
  safely(() => localStorage.setItem(CONSENT_KEY, 'true'));
  suspended = readConsent() !== 'true';
  if (!enabled || !hasConsented()) return;
  if (loadedPosthog) {
    safely(() => loadedPosthog.opt_in_capturing({ captureEventName: false }));
    window.addEventListener('storage', onConsentStorage);
  } else loadPosthog();
}

export function revokeConsent() {
  stopCapturing();
  safely(() => localStorage.setItem(CONSENT_KEY, 'false'));
}

// Clears any prior answer so the consent banner reappears on next load —
// used by the "manage cookie preferences" link on the Policy page, since
// hasAnswered() gates the banner and there's otherwise no way back to it
// after the first visit.
export function resetConsent() {
  stopCapturing();
  safely(() => localStorage.removeItem(CONSENT_KEY));
}

function track(event, props) {
  const epoch = operationEpoch;
  if (enabled && hasConsented())
    loadPosthog().then((posthog) => {
      if (posthog && epoch === operationEpoch && hasConsented()) safely(() => posthog.capture(event, props));
    });
}

function identify(userId, props) {
  const epoch = operationEpoch;
  if (enabled && hasConsented())
    loadPosthog().then((posthog) => {
      if (posthog && epoch === operationEpoch && hasConsented()) safely(() => posthog.identify(userId, props));
    });
}

function reset() {
  operationEpoch += 1;
  resetPending = true;
  if (loadedPosthog) {
    safely(() => loadedPosthog.reset());
    resetPending = false;
  }
}

export { enabled, track, identify, reset };
