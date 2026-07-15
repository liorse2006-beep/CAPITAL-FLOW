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

export function hasConsented() {
  return localStorage.getItem(CONSENT_KEY) === 'true';
}

export function hasAnswered() {
  return localStorage.getItem(CONSENT_KEY) !== null;
}

let posthogPromise = null;
function loadPosthog() {
  if (!enabled) return Promise.resolve(null);
  if (!posthogPromise) {
    posthogPromise = import('posthog-js').then((mod) => {
      const posthog = mod.default;
      posthog.init(KEY, {
        api_host: HOST,
        // Page views are tracked manually on route change (App.jsx watches
        // location.pathname), not via posthog's own history-API patching —
        // this app already has React Router doing that job and
        // double-tracking would skew funnels.
        capture_pageview: false,
        capture_pageleave: true,
      });
      return posthog;
    });
  }
  return posthogPromise;
}

// Only load on startup if the user has already consented
if (enabled && hasConsented()) loadPosthog();

export function giveConsent() {
  localStorage.setItem(CONSENT_KEY, 'true');
  if (enabled) loadPosthog();
}

export function revokeConsent() {
  localStorage.setItem(CONSENT_KEY, 'false');
}

function track(event, props) {
  if (enabled && hasConsented()) loadPosthog().then((posthog) => posthog && posthog.capture(event, props));
}

function identify(userId, props) {
  if (enabled && hasConsented()) loadPosthog().then((posthog) => posthog && posthog.identify(userId, props));
}

function reset() {
  if (enabled) loadPosthog().then((posthog) => posthog && posthog.reset());
}

export { enabled, track, identify, reset };
