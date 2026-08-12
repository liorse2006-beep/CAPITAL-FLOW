import React, { useEffect, useRef } from 'react';
import bodyHtml from './landing/landing.body.html?raw';
import { initLandingEffects } from './landing/effects';
import './landing/landing.scoped.css';

// Public marketing page shown at "/" for logged-out visitors (see App.jsx:
// `location.pathname === '/' && !user`). Ported from a hand-authored static
// HTML prototype rather than rebuilt element-by-element as JSX — it's all
// visual/marketing copy with no app state, so the highest-fidelity path was
// to keep the markup and its effects (WebGL scan background, tilt cards,
// FAQ accordion, entrance animation) intact and just give them a React
// mount/unmount lifecycle. See landing/effects.js for the teardown logic
// that makes that safe inside an SPA route.
export default function LandingPage({ onGetStarted }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const cleanup = initLandingEffects(rootRef.current, onGetStarted);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-landing-page" dir="rtl" lang="he" ref={rootRef} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
  );
}
